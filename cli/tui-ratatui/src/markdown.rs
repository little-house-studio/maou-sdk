//! Markdown → styled lines (Ink MarkdownRenderer subset).
//!
//! Parsing: `pulldown-cmark` (CommonMark + tables / strikethrough / task lists).
//! Paint: custom — box tables, fence chrome, theme colors (parity with Ink).

use crate::theme::Theme;
use pulldown_cmark::{
    Alignment as MdAlign, CodeBlockKind, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd,
};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use unicode_width::UnicodeWidthChar;

pub fn wrap_str(s: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![String::new()];
    }
    if s.is_empty() {
        return vec![String::new()];
    }
    let mut rows = Vec::new();
    let mut cur = String::new();
    let mut w = 0usize;
    for ch in s.chars() {
        let cw = UnicodeWidthChar::width(ch).unwrap_or(1);
        if w + cw > width && !cur.is_empty() {
            rows.push(cur);
            cur = String::new();
            w = 0;
        }
        cur.push(ch);
        w += cw;
    }
    if !cur.is_empty() {
        rows.push(cur);
    }
    rows
}

pub fn render_markdown(text: &str, width: usize, theme: &Theme, user_block: bool) -> Vec<Line<'static>> {
    let w = width.max(8);
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(text, options);
    let mut out: Vec<Line<'static>> = Vec::new();
    let mut ctx = WalkCtx::new(w, theme, user_block);

    for ev in parser {
        ctx.feed(ev, &mut out);
    }
    ctx.flush_pending(&mut out);
    out
}

// ── event walker ────────────────────────────────────────────────────────────

struct WalkCtx<'a> {
    w: usize,
    theme: &'a Theme,
    user_block: bool,

    // inline style stack for current block
    bold: usize,
    italic: usize,
    strike: usize,
    /// pending link dest (None = not in link)
    link_href: Option<String>,
    /// accumulated styled spans for current leaf block (paragraph/heading/item…)
    spans: Vec<Span<'static>>,
    /// prefix when flushing current leaf (list marker, etc.)
    leaf_prefix: String,
    /// heading level if inside heading (1–3+)
    heading: Option<u8>,
    /// inside fenced/indented code block
    in_code: bool,
    code_buf: String,
    code_lang: String,
    /// blockquote depth
    quote_depth: usize,
    /// ordered list stack: Some(next_num) or None for unordered
    list_stack: Vec<Option<u64>>,
    /// after TaskListMarker, skip default bullet (marker already set prefix)
    item_task_done: bool,
    /// table assembly
    table: Option<TableBuild>,
}

struct TableBuild {
    aligns: Vec<Align>,
    header: Vec<String>,
    rows: Vec<Vec<String>>,
    in_head: bool,
    cur_row: Vec<String>,
    cur_cell: String,
}

impl<'a> WalkCtx<'a> {
    fn new(w: usize, theme: &'a Theme, user_block: bool) -> Self {
        Self {
            w,
            theme,
            user_block,
            bold: 0,
            italic: 0,
            strike: 0,
            link_href: None,
            spans: Vec::new(),
            leaf_prefix: String::new(),
            heading: None,
            in_code: false,
            code_buf: String::new(),
            code_lang: String::new(),
            quote_depth: 0,
            list_stack: Vec::new(),
            item_task_done: false,
            table: None,
        }
    }

    fn base_style(&self) -> Style {
        if self.user_block && self.heading.is_none() && !self.in_code && self.quote_depth == 0 {
            Style::default().fg(self.theme.user).bg(self.theme.user_bg)
        } else {
            Style::default().fg(self.theme.fg)
        }
    }

    fn current_style(&self) -> Style {
        let mut st = self.base_style();
        if self.bold > 0 {
            st = st.add_modifier(Modifier::BOLD);
        }
        if self.italic > 0 {
            st = st.add_modifier(Modifier::ITALIC);
        }
        if self.strike > 0 {
            st = st.add_modifier(Modifier::CROSSED_OUT).fg(self.theme.dim);
        }
        if self.link_href.is_some() {
            st = Style::default()
                .fg(self.theme.md_link)
                .add_modifier(Modifier::UNDERLINED);
            if self.bold > 0 {
                st = st.add_modifier(Modifier::BOLD);
            }
        }
        st
    }

    fn push_text(&mut self, s: &str) {
        if s.is_empty() {
            return;
        }
        if let Some(t) = self.table.as_mut() {
            t.cur_cell.push_str(s);
            return;
        }
        let style = self.current_style();
        // merge adjacent same-style spans
        if let Some(last) = self.spans.last_mut() {
            if last.style == style {
                let mut merged = last.content.to_string();
                merged.push_str(s);
                *last = Span::styled(merged, style);
                return;
            }
        }
        self.spans.push(Span::styled(s.to_string(), style));
    }

    fn feed(&mut self, ev: Event<'_>, out: &mut Vec<Line<'static>>) {
        match ev {
            Event::Start(tag) => self.start_tag(tag, out),
            Event::End(tag) => self.end_tag(tag, out),
            Event::Text(t) => {
                if self.in_code {
                    self.code_buf.push_str(&t);
                } else {
                    self.push_text(&t);
                }
            }
            Event::Code(t) => {
                if self.table.is_some() {
                    self.push_text(&t);
                } else {
                    self.spans.push(Span::styled(
                        t.into_string(),
                        Style::default()
                            .fg(self.theme.md_code)
                            .add_modifier(Modifier::BOLD),
                    ));
                }
            }
            Event::SoftBreak => {
                if self.in_code {
                    self.code_buf.push('\n');
                } else if self.table.is_some() {
                    self.push_text(" ");
                } else {
                    self.push_text(" ");
                }
            }
            Event::HardBreak => {
                if self.in_code {
                    self.code_buf.push('\n');
                } else if self.table.is_some() {
                    self.push_text(" ");
                } else {
                    // force line break inside leaf: flush current spans as a line, keep prefix empty for cont.
                    self.flush_leaf_line(out, false);
                }
            }
            Event::Rule => {
                out.push(Line::from(Span::styled(
                    format!("  {}", "─".repeat(self.w.saturating_sub(4).min(48))),
                    Style::default().fg(self.theme.md_hr),
                )));
            }
            Event::TaskListMarker(checked) => {
                self.item_task_done = true;
                self.leaf_prefix = if checked {
                    "  ☑ ".to_string()
                } else {
                    "  ☐ ".to_string()
                };
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                // strip tags lightly — show text-ish content only if plain
                let plain = strip_simple_html(&html);
                if !plain.is_empty() {
                    self.push_text(&plain);
                }
            }
            Event::FootnoteReference(_) | Event::InlineMath(_) | Event::DisplayMath(_) => {}
        }
    }

    fn start_tag(&mut self, tag: Tag<'_>, out: &mut Vec<Line<'static>>) {
        match tag {
            Tag::Paragraph => {
                self.spans.clear();
                if self.leaf_prefix.is_empty() {
                    self.leaf_prefix = self.default_para_prefix();
                }
            }
            Tag::Heading { level, .. } => {
                self.spans.clear();
                self.heading = Some(match level {
                    HeadingLevel::H1 => 1,
                    HeadingLevel::H2 => 2,
                    HeadingLevel::H3 => 3,
                    _ => 3,
                });
                self.leaf_prefix = "  ".to_string();
            }
            Tag::BlockQuote(_) => {
                self.quote_depth += 1;
            }
            Tag::CodeBlock(kind) => {
                self.in_code = true;
                self.code_buf.clear();
                self.code_lang = match kind {
                    CodeBlockKind::Fenced(lang) => lang.into_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                out.push(Line::from(Span::styled(
                    format!("  ┌ code {}", self.code_lang),
                    Style::default().fg(self.theme.md_code),
                )));
            }
            Tag::List(start) => {
                self.list_stack.push(start);
            }
            Tag::Item => {
                self.spans.clear();
                self.item_task_done = false;
                let depth = self.list_stack.len().saturating_sub(1);
                let pad = " ".repeat(2 + depth * 2);
                if let Some(Some(n)) = self.list_stack.last().copied() {
                    self.leaf_prefix = format!("{pad}{n}. ");
                    if let Some(slot) = self.list_stack.last_mut() {
                        if let Some(v) = slot.as_mut() {
                            *v += 1;
                        }
                    }
                } else {
                    self.leaf_prefix = format!("{pad}• ");
                }
            }
            Tag::Emphasis => self.italic += 1,
            Tag::Strong => self.bold += 1,
            Tag::Strikethrough => self.strike += 1,
            Tag::Link { dest_url, .. } => {
                self.link_href = Some(dest_url.into_string());
            }
            Tag::Image { dest_url, title, .. } => {
                // render as link-like: alt text collected until End, show (url)
                self.link_href = Some(if title.is_empty() {
                    dest_url.into_string()
                } else {
                    format!("{dest_url}")
                });
            }
            Tag::Table(aligns) => {
                self.table = Some(TableBuild {
                    aligns: aligns.iter().map(map_align).collect(),
                    header: Vec::new(),
                    rows: Vec::new(),
                    in_head: false,
                    cur_row: Vec::new(),
                    cur_cell: String::new(),
                });
            }
            Tag::TableHead => {
                if let Some(t) = self.table.as_mut() {
                    t.in_head = true;
                }
            }
            Tag::TableRow => {
                if let Some(t) = self.table.as_mut() {
                    t.cur_row.clear();
                }
            }
            Tag::TableCell => {
                if let Some(t) = self.table.as_mut() {
                    t.cur_cell.clear();
                }
            }
            Tag::HtmlBlock
            | Tag::FootnoteDefinition(_)
            | Tag::DefinitionList
            | Tag::DefinitionListTitle
            | Tag::DefinitionListDefinition
            | Tag::MetadataBlock(_) => {}
        }
    }

    fn end_tag(&mut self, tag: TagEnd, out: &mut Vec<Line<'static>>) {
        match tag {
            TagEnd::Paragraph => {
                self.flush_paragraph(out);
            }
            TagEnd::Heading(_) => {
                let level = self.heading.take().unwrap_or(1);
                let color = match level {
                    1 => self.theme.md_heading,
                    2 => self.theme.md_heading2,
                    _ => self.theme.md_heading3,
                };
                let body: String = self
                    .spans
                    .iter()
                    .map(|s| s.content.as_ref())
                    .collect();
                self.spans.clear();
                push_wrapped(out, "  ", &body, color, true, self.w);
                self.leaf_prefix.clear();
            }
            TagEnd::BlockQuote(_) => {
                self.quote_depth = self.quote_depth.saturating_sub(1);
            }
            TagEnd::CodeBlock => {
                // emit code body line-by-line (preserve internal newlines)
                let body = std::mem::take(&mut self.code_buf);
                for line in body.split('\n') {
                    // pulldown often leaves a trailing empty from final newline — still show blank code lines as empty chrome
                    for chunk in wrap_str(line, self.w.saturating_sub(4)) {
                        out.push(Line::from(Span::styled(
                            format!("  │ {chunk}"),
                            Style::default().fg(self.theme.md_code_block),
                        )));
                    }
                }
                // if body ended with newline, last split is empty and already emitted; if empty fence, emit nothing extra
                out.push(Line::from(Span::styled(
                    "  └────",
                    Style::default().fg(self.theme.dim),
                )));
                self.in_code = false;
                self.code_lang.clear();
            }
            TagEnd::List(_) => {
                self.list_stack.pop();
            }
            TagEnd::Item => {
                if !self.spans.is_empty() || !self.leaf_prefix.is_empty() {
                    self.flush_paragraph(out);
                }
                self.item_task_done = false;
                self.leaf_prefix.clear();
            }
            TagEnd::Emphasis => self.italic = self.italic.saturating_sub(1),
            TagEnd::Strong => self.bold = self.bold.saturating_sub(1),
            TagEnd::Strikethrough => self.strike = self.strike.saturating_sub(1),
            TagEnd::Link => {
                // Ink: show dim (href) when it differs from the visible label.
                if let Some(href) = self.link_href.take() {
                    let label: String = self
                        .spans
                        .iter()
                        .rev()
                        .take_while(|s| {
                            s.style.fg == Some(self.theme.md_link)
                                || s.style.add_modifier.contains(Modifier::UNDERLINED)
                        })
                        .map(|s| s.content.as_ref())
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect();
                    if !href.is_empty() && href != label {
                        self.spans.push(Span::styled(
                            format!(" ({href})"),
                            Style::default().fg(self.theme.dim),
                        ));
                    }
                }
            }
            TagEnd::Image => {
                if let Some(href) = self.link_href.take() {
                    let alt: String = self.spans.iter().map(|s| s.content.as_ref()).collect();
                    if alt.is_empty() {
                        self.spans.push(Span::styled(
                            format!("[{href}]"),
                            Style::default()
                                .fg(self.theme.md_link)
                                .add_modifier(Modifier::UNDERLINED),
                        ));
                    } else if !href.is_empty() && href != alt {
                        self.spans.push(Span::styled(
                            format!(" ({href})"),
                            Style::default().fg(self.theme.dim),
                        ));
                    }
                }
            }
            TagEnd::Table => {
                if let Some(t) = self.table.take() {
                    let lines = render_box_table(&t.header, &t.rows, &t.aligns, self.w, self.theme);
                    out.extend(lines);
                }
            }
            TagEnd::TableHead => {
                // pulldown-cmark: head cells are not always wrapped in TableRow
                if let Some(t) = self.table.as_mut() {
                    if !t.cur_row.is_empty() {
                        t.header = std::mem::take(&mut t.cur_row);
                    }
                    t.in_head = false;
                }
            }
            TagEnd::TableRow => {
                if let Some(t) = self.table.as_mut() {
                    let row = std::mem::take(&mut t.cur_row);
                    if t.in_head {
                        t.header = row;
                    } else if !row.is_empty() {
                        t.rows.push(row);
                    }
                }
            }
            TagEnd::TableCell => {
                if let Some(t) = self.table.as_mut() {
                    t.cur_row.push(std::mem::take(&mut t.cur_cell));
                }
            }
            TagEnd::HtmlBlock
            | TagEnd::FootnoteDefinition
            | TagEnd::DefinitionList
            | TagEnd::DefinitionListTitle
            | TagEnd::DefinitionListDefinition
            | TagEnd::MetadataBlock(_) => {}
        }
    }

    fn default_para_prefix(&self) -> String {
        if self.quote_depth > 0 {
            format!("{}│ ", " ".repeat(2 + self.quote_depth.saturating_sub(1)))
        } else {
            "  ".to_string()
        }
    }

    fn flush_paragraph(&mut self, out: &mut Vec<Line<'static>>) {
        // Heuristic: single-line diff add from agents (`+ foo`) — keep Ink-ish coloring
        if self.heading.is_none()
            && self.quote_depth == 0
            && self.list_stack.is_empty()
            && self.spans.len() == 1
        {
            let raw = self.spans[0].content.as_ref();
            if let Some(body) = raw.strip_prefix("+ ") {
                push_wrapped(out, "  + ", body, self.theme.diff_add, false, self.w);
                self.spans.clear();
                self.leaf_prefix.clear();
                return;
            }
        }

        if self.spans.is_empty() && self.leaf_prefix.trim().is_empty() {
            self.leaf_prefix.clear();
            return;
        }

        let prefix = if self.leaf_prefix.is_empty() {
            self.default_para_prefix()
        } else {
            self.leaf_prefix.clone()
        };

        if self.quote_depth > 0 && self.list_stack.is_empty() && self.heading.is_none() {
            // quote: border glyph + body color
            let indent = prefix;
            let body: String = self.spans.iter().map(|s| s.content.as_ref()).collect();
            for chunk in wrap_str(&body, self.w.saturating_sub(indent.chars().count().max(4))) {
                out.push(Line::from(vec![
                    Span::styled(
                        indent.clone(),
                        Style::default().fg(self.theme.md_quote_border),
                    ),
                    Span::styled(chunk, Style::default().fg(self.theme.md_quote)),
                ]));
            }
        } else {
            push_inline_styled(out, &prefix, &std::mem::take(&mut self.spans), self.base_style(), self.w);
        }
        self.spans.clear();
        // after paragraph inside item, clear prefix so nested paras don't re-bullet
        if !self.list_stack.is_empty() {
            // continuation indent for multi-para list items
            let depth = self.list_stack.len().saturating_sub(1);
            self.leaf_prefix = " ".repeat(2 + depth * 2 + 2);
        } else {
            self.leaf_prefix.clear();
        }
    }

    fn flush_leaf_line(&mut self, out: &mut Vec<Line<'static>>, clear_prefix: bool) {
        if self.spans.is_empty() {
            return;
        }
        let prefix = if self.leaf_prefix.is_empty() {
            "  ".to_string()
        } else {
            self.leaf_prefix.clone()
        };
        push_inline_styled(
            out,
            &prefix,
            &std::mem::take(&mut self.spans),
            self.base_style(),
            self.w,
        );
        self.spans.clear();
        if clear_prefix {
            self.leaf_prefix.clear();
        } else {
            self.leaf_prefix = " ".repeat(prefix.chars().count());
        }
    }

    fn flush_pending(&mut self, out: &mut Vec<Line<'static>>) {
        if !self.spans.is_empty() {
            self.flush_paragraph(out);
        }
        if self.in_code {
            // unclosed fence — still close chrome
            let body = std::mem::take(&mut self.code_buf);
            for line in body.split('\n') {
                for chunk in wrap_str(line, self.w.saturating_sub(4)) {
                    out.push(Line::from(Span::styled(
                        format!("  │ {chunk}"),
                        Style::default().fg(self.theme.md_code_block),
                    )));
                }
            }
            out.push(Line::from(Span::styled(
                "  └────",
                Style::default().fg(self.theme.dim),
            )));
            self.in_code = false;
        }
        if let Some(t) = self.table.take() {
            out.extend(render_box_table(
                &t.header,
                &t.rows,
                &t.aligns,
                self.w,
                self.theme,
            ));
        }
    }
}

fn map_align(a: &MdAlign) -> Align {
    match a {
        MdAlign::None | MdAlign::Left => Align::Left,
        MdAlign::Center => Align::Center,
        MdAlign::Right => Align::Right,
    }
}

fn strip_simple_html(html: &CowStr<'_>) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

// ── paint helpers (custom; Ink visual language) ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum Align {
    Left,
    Center,
    Right,
}

fn pad_cell(s: &str, width: usize, align: Align) -> String {
    use unicode_width::UnicodeWidthStr;
    let mut t = s.to_string();
    let mut tw = UnicodeWidthStr::width(t.as_str());
    if tw > width {
        let mut out = String::new();
        let mut used = 0usize;
        for ch in t.chars() {
            let cw = UnicodeWidthChar::width(ch).unwrap_or(1);
            if used + cw > width.saturating_sub(1) {
                break;
            }
            out.push(ch);
            used += cw;
        }
        out.push('…');
        t = out;
        tw = UnicodeWidthStr::width(t.as_str());
    }
    let pad = width.saturating_sub(tw);
    match align {
        Align::Right => format!("{}{t}", " ".repeat(pad)),
        Align::Center => {
            let l = pad / 2;
            format!("{}{t}{}", " ".repeat(l), " ".repeat(pad - l))
        }
        Align::Left => format!("{t}{}", " ".repeat(pad)),
    }
}

/// Ink MarkdownRenderer box table (┌─┬─┐ / │ │ / └─┴─┘).
fn render_box_table(
    header: &[String],
    rows: &[Vec<String>],
    align: &[Align],
    max_width: usize,
    theme: &Theme,
) -> Vec<Line<'static>> {
    use unicode_width::UnicodeWidthStr;
    let col_count = header
        .len()
        .max(rows.iter().map(|r| r.len()).max().unwrap_or(0))
        .max(1);
    let mut widths = vec![2usize; col_count];
    for (i, h) in header.iter().enumerate() {
        widths[i] = widths[i].max(UnicodeWidthStr::width(h.as_str()).max(1)).min(36);
    }
    for row in rows {
        for (i, c) in row.iter().enumerate() {
            if i < col_count {
                widths[i] = widths[i]
                    .max(UnicodeWidthStr::width(c.as_str()).max(1))
                    .min(36);
            }
        }
    }
    let chrome = 2 * col_count + (col_count + 1);
    let budget = max_width.saturating_sub(2).max(24);
    let content_sum: usize = widths.iter().sum();
    let inner = content_sum + chrome;
    if inner > budget && content_sum > 0 {
        let content_budget = budget.saturating_sub(chrome).max(col_count * 3);
        for w in widths.iter_mut() {
            *w = ((*w as f64) * (content_budget as f64 / content_sum as f64))
                .floor()
                .max(3.0) as usize;
        }
    }

    let make_border = |left: &str, mid: &str, right: &str, fill: char| -> String {
        let segs: Vec<String> = widths
            .iter()
            .map(|w| fill.to_string().repeat(w + 2))
            .collect();
        format!("{left}{}{right}", segs.join(mid))
    };
    let make_row = |cells: &[String], al: &[Align]| -> String {
        let mut parts = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let c = cells.get(i).map(|s| s.as_str()).unwrap_or("");
            let a = al.get(i).copied().unwrap_or(Align::Left);
            parts.push(format!(" {} ", pad_cell(c, widths[i], a)));
        }
        format!("│{}│", parts.join("│"))
    };

    let top = make_border("┌", "┬", "┐", '─');
    let mid = make_border("├", "┼", "┤", '─');
    let bot = make_border("└", "┴", "┘", '─');
    let head_row = make_row(header, align);

    let mut out = Vec::new();
    out.push(Line::from(Span::styled(
        format!("  {top}"),
        Style::default().fg(theme.muted),
    )));
    out.push(Line::from(Span::styled(
        format!("  {head_row}"),
        Style::default()
            .fg(theme.accent)
            .add_modifier(Modifier::BOLD),
    )));
    out.push(Line::from(Span::styled(
        format!("  {mid}"),
        Style::default().fg(theme.muted),
    )));
    let max_data = 40usize;
    let shown = rows.len().min(max_data);
    for row in rows.iter().take(shown) {
        let r = make_row(row, align);
        out.push(Line::from(Span::styled(
            format!("  {r}"),
            Style::default().fg(theme.fg),
        )));
    }
    if rows.len() > shown {
        out.push(Line::from(Span::styled(
            format!("  …（表格已折叠，共 {} 行）", rows.len()),
            Style::default().fg(theme.dim),
        )));
    }
    out.push(Line::from(Span::styled(
        format!("  {bot}"),
        Style::default().fg(theme.muted),
    )));
    out
}

fn push_wrapped(
    out: &mut Vec<Line<'static>>,
    prefix: &str,
    body: &str,
    color: ratatui::style::Color,
    bold: bool,
    width: usize,
) {
    let mut st = Style::default().fg(color);
    if bold {
        st = st.add_modifier(Modifier::BOLD);
    }
    for (i, chunk) in wrap_str(body, width.saturating_sub(prefix.chars().count() + 1))
        .into_iter()
        .enumerate()
    {
        let p = if i == 0 {
            prefix.to_string()
        } else {
            " ".repeat(prefix.chars().count())
        };
        out.push(Line::from(Span::styled(format!("{p}{chunk}"), st)));
    }
}

fn push_inline_styled(
    out: &mut Vec<Line<'static>>,
    prefix: &str,
    spans: &[Span<'static>],
    base: Style,
    width: usize,
) {
    let max_w = width
        .saturating_sub(UnicodeWidthChar::width(' ').unwrap_or(1) * prefix.chars().count().max(1))
        .max(4);
    let rows = wrap_styled_spans(spans, max_w, base);
    for (i, row) in rows.into_iter().enumerate() {
        let p = if i == 0 {
            prefix.to_string()
        } else {
            " ".repeat(prefix.chars().count())
        };
        let mut line_spans = vec![Span::styled(p, base)];
        line_spans.extend(row);
        out.push(Line::from(line_spans));
    }
}

fn wrap_styled_spans(
    spans: &[Span<'static>],
    max_w: usize,
    base: Style,
) -> Vec<Vec<Span<'static>>> {
    if max_w == 0 {
        return vec![vec![Span::styled(String::new(), base)]];
    }
    let mut rows: Vec<Vec<Span<'static>>> = Vec::new();
    let mut cur: Vec<Span<'static>> = Vec::new();
    let mut cur_w = 0usize;

    let flush = |rows: &mut Vec<Vec<Span<'static>>>, cur: &mut Vec<Span<'static>>, cur_w: &mut usize| {
        if !cur.is_empty() {
            rows.push(std::mem::take(cur));
        } else if rows.is_empty() {
            rows.push(vec![Span::styled(String::new(), base)]);
        }
        *cur_w = 0;
    };

    for sp in spans {
        let style = sp.style;
        let content = sp.content.as_ref();
        if content.is_empty() {
            continue;
        }
        for ch in content.chars() {
            let cw = UnicodeWidthChar::width(ch).unwrap_or(1);
            if cur_w + cw > max_w && cur_w > 0 {
                flush(&mut rows, &mut cur, &mut cur_w);
            }
            if let Some(last) = cur.last_mut() {
                if last.style == style {
                    let mut s = last.content.to_string();
                    s.push(ch);
                    *last = Span::styled(s, style);
                    cur_w += cw;
                    continue;
                }
            }
            cur.push(Span::styled(ch.to_string(), style));
            cur_w += cw;
        }
    }
    if !cur.is_empty() || rows.is_empty() {
        flush(&mut rows, &mut cur, &mut cur_w);
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::Theme;

    fn plain(lines: &[Line]) -> String {
        lines
            .iter()
            .map(|l| {
                l.spans
                    .iter()
                    .map(|s| s.content.as_ref())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn inline_link_and_strikethrough_match_ink() {
        let theme = Theme::default();
        let lines = render_markdown(
            "see [docs](https://example.com) and ~~old~~",
            80,
            &theme,
            false,
        );
        let p = plain(&lines);
        assert!(p.contains("docs"), "label: {p}");
        assert!(
            p.contains("https://example.com") || p.contains("example.com"),
            "href: {p}"
        );
        assert!(p.contains("old"), "strike body: {p}");
        let spans: Vec<_> = lines.iter().flat_map(|l| l.spans.iter()).collect();
        assert!(
            spans.iter().any(|s| s.style.fg == Some(theme.md_link)),
            "link color"
        );
        assert!(
            spans
                .iter()
                .any(|s| s.style.add_modifier.contains(Modifier::CROSSED_OUT)),
            "strikethrough"
        );
    }

    #[test]
    fn headings_and_fence_still_work() {
        let theme = Theme::default();
        let lines = render_markdown(
            "# Title\n\n```rs\nlet x = 1;\n```\n\n- item",
            60,
            &theme,
            false,
        );
        let p = plain(&lines);
        assert!(p.contains("Title"), "{p}");
        assert!(p.contains("let x") || p.contains("code"), "{p}");
        assert!(p.contains("item"), "{p}");
    }

    #[test]
    fn box_table_matches_ink_shape() {
        let theme = Theme::default();
        let md = "| Name | Age |\n| --- | ---: |\n| Ada | 36 |\n| Bob | 1 |";
        let lines = render_markdown(md, 80, &theme, false);
        let p = plain(&lines);
        assert!(p.contains('┌') && p.contains('┐'), "top: {p}");
        assert!(p.contains('├') && p.contains('┤'), "mid: {p}");
        assert!(p.contains('└') && p.contains('┘'), "bot: {p}");
        assert!(p.contains("Name") && p.contains("Ada"), "cells: {p}");
        assert!(p.contains('│'), "pipes: {p}");
    }
}
