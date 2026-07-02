"""工具函数"""


def format_number(n):
    """格式化数字"""
    return f"{n:,.2f}"


def parse_int(s):
    """解析整数"""
    try:
        return int(s)
    except ValueError:
        return None
