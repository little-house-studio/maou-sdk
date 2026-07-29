#!/usr/bin/env python3
"""
maou terminal/file condition evaluator.

Reads JSON lines from stdin (or a file via --path) and evaluates a restricted
Python *expression* per line. Used by use_terminal return_when=filter|until.

Env bindings for expr:
  line  str   current line (no trailing newline)
  n     int   1-based line number
  re    module
  m     re.Match | None  if --match provided, else None

Safety: AST whitelist only (no imports, attribute writes, comprehensions with calls to unknown).
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from typing import Any, Optional


# ── AST safety ─────────────────────────────────────────────────────────────

_ALLOWED_NODES = (
    ast.Expression,
    ast.BoolOp,
    ast.BinOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Call,
    ast.Name,
    ast.Load,
    ast.Constant,
    ast.Attribute,
    ast.Subscript,
    ast.Slice,
    # boolops / operators
    ast.And,
    ast.Or,
    ast.Not,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
    ast.Is,
    ast.IsNot,
    ast.In,
    ast.NotIn,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.UAdd,
    ast.USub,
    # containers for convenience
    ast.List,
    ast.Tuple,
    ast.Dict,
    # Python 3.8 compatibility
    # ast.Num / ast.Str removed in 3.14 but may appear on old trees
)

_ALLOWED_FUNCS = frozenset(
    {
        "int",
        "float",
        "str",
        "bool",
        "len",
        "abs",
        "min",
        "max",
        "round",
        "ord",
        "chr",
        "isinstance",
    }
)

_ALLOWED_ATTRS_ON_MATCH = frozenset(
    {"group", "groups", "start", "end", "span", "string", "re"}
)
_ALLOWED_ATTRS_ON_STR = frozenset(
    {
        "lower",
        "upper",
        "strip",
        "lstrip",
        "rstrip",
        "startswith",
        "endswith",
        "find",
        "rfind",
        "count",
        "replace",
        "split",
        "rsplit",
        "isdigit",
        "isalpha",
        "isalnum",
    }
)
_ALLOWED_RE_FUNCS = frozenset(
    {"search", "match", "fullmatch", "findall", "finditer", "split", "sub", "escape", "compile"}
)


class UnsafeExpr(ValueError):
    pass


def _check_node(node: ast.AST) -> None:
    tname = type(node).__name__
    if tname in ("Num", "Str", "NameConstant", "Ellipsis", "Index"):  # py<3.9 Index
        for child in ast.iter_child_nodes(node):
            _check_node(child)
        return

    if not isinstance(node, _ALLOWED_NODES):
        raise UnsafeExpr(f"disallowed syntax: {tname}")

    if isinstance(node, ast.Call):
        func = node.func
        if node.keywords:
            raise UnsafeExpr("keyword arguments not allowed")
        if isinstance(func, ast.Name):
            if func.id not in _ALLOWED_FUNCS:
                raise UnsafeExpr(f"call not allowed: {func.id}")
        elif isinstance(func, ast.Attribute):
            if isinstance(func.value, ast.Name) and func.value.id == "re":
                if func.attr not in _ALLOWED_RE_FUNCS:
                    raise UnsafeExpr(f"re.{func.attr} not allowed")
            elif isinstance(func.value, ast.Name) and func.value.id == "m":
                if func.attr not in _ALLOWED_ATTRS_ON_MATCH:
                    raise UnsafeExpr(f"m.{func.attr} not allowed")
            elif isinstance(func.value, ast.Name) and func.value.id == "line":
                if func.attr not in _ALLOWED_ATTRS_ON_STR:
                    raise UnsafeExpr(f"line.{func.attr} not allowed")
            else:
                # e.g. m.group(1) already Name; chained Call.attr limited
                if isinstance(func.value, ast.Call):
                    _check_node(func.value)
                    if func.attr not in _ALLOWED_ATTRS_ON_MATCH | _ALLOWED_ATTRS_ON_STR:
                        raise UnsafeExpr(f"method not allowed: {func.attr}")
                else:
                    raise UnsafeExpr("only re.*/m.*/line.* or builtins may be called")
        else:
            raise UnsafeExpr("complex call not allowed")
        for a in node.args:
            _check_node(a)
        return

    if isinstance(node, ast.Attribute):
        if isinstance(node.value, ast.Name):
            if node.value.id == "m" and node.attr in _ALLOWED_ATTRS_ON_MATCH:
                return
            if node.value.id == "line" and node.attr in _ALLOWED_ATTRS_ON_STR:
                return
            if node.value.id == "re":
                return
            raise UnsafeExpr(f"attribute not allowed: {node.value.id}.{node.attr}")
        _check_node(node.value)
        return

    if isinstance(node, ast.Name):
        if node.id in ("line", "n", "re", "m", "True", "False", "None"):
            return
        raise UnsafeExpr(f"name not allowed: {node.id}")

    for child in ast.iter_child_nodes(node):
        _check_node(child)


def compile_expr(expr: str) -> ast.Expression:
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise UnsafeExpr(f"syntax error: {e}") from e
    _check_node(tree)
    return tree  # type: ignore[return-value]


def eval_expr(tree: ast.Expression, env: dict[str, Any]) -> Any:
    code = compile(tree, "<maou-condition>", "eval")
    safe_builtins = {
        "int": int,
        "float": float,
        "str": str,
        "bool": bool,
        "len": len,
        "abs": abs,
        "min": min,
        "max": max,
        "round": round,
        "ord": ord,
        "chr": chr,
        "isinstance": isinstance,
        "True": True,
        "False": False,
        "None": None,
    }
    return eval(code, {"__builtins__": safe_builtins}, env)  # noqa: S307 — AST-gated


def process_lines(
    lines: list[str],
    expr: str,
    match_pat: Optional[str],
    mode: str,
    max_hits: int,
    context_lines: int,
) -> dict[str, Any]:
    tree = compile_expr(expr)
    cre = re.compile(match_pat) if match_pat else None
    hits: list[dict[str, Any]] = []
    all_lines = [ln.rstrip("\r\n") for ln in lines]

    for n, line in enumerate(all_lines, 1):
        m = cre.search(line) if cre else None
        # if match required implicitly: when match_pat set and expr uses m
        env = {"line": line, "n": n, "re": re, "m": m}
        try:
            ok = bool(eval_expr(tree, env))
        except Exception:
            # 单行求值失败视为未命中，继续
            continue
        if not ok:
            continue
        value = None
        if m is not None:
            try:
                if m.lastindex:
                    value = m.group(1)
            except Exception:
                value = None
        start = max(0, n - 1 - context_lines)
        end = min(len(all_lines), n + context_lines)
        hit = {
            "line": n,
            "text": line[:2000],
            "value": value,
            "context_before": all_lines[start : n - 1][-context_lines:],
            "context_after": all_lines[n:end][:context_lines],
        }
        hits.append(hit)
        if mode == "until":
            break
        if len(hits) >= max_hits:
            break

    return {
        "ok": True,
        "mode": mode,
        "matched": len(hits),
        "hits": hits,
        "truncated": mode == "filter" and len(hits) >= max_hits,
        "scanned": len(all_lines),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expr", required=True)
    ap.add_argument("--match", default="")
    ap.add_argument("--mode", choices=("filter", "until"), default="filter")
    ap.add_argument("--max-hits", type=int, default=100)
    ap.add_argument("--context-lines", type=int, default=3)
    ap.add_argument("--path", default="")  # if set, read file; else stdin
    args = ap.parse_args()

    try:
        if args.path:
            with open(args.path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        else:
            lines = sys.stdin.readlines()
        result = process_lines(
            lines,
            args.expr,
            args.match or None,
            args.mode,
            max(1, args.max_hits),
            max(0, args.context_lines),
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except UnsafeExpr as e:
        print(json.dumps({"ok": False, "error": "unsafe_or_bad_expr", "message": str(e)}))
        return 2
    except FileNotFoundError:
        print(json.dumps({"ok": False, "error": "file_not_found", "message": args.path}))
        return 2
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "eval_failed",
                    "message": f"{type(e).__name__}: {e}",
                }
            )
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
