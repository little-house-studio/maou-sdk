"""计算器模块 - 支持四则运算"""


def add(a, b):
    """加法"""
    return a + b


def subtract(a, b):
    """减法"""
    return a - b


def multiply(a, b):
    """乘法"""
    return a * b


def divide(a, b):
    """除法，b=0 抛错"""
    if b == 0:
        raise ValueError("除数不能为零")
    return a / b


def is_prime(n):
    """判断素数"""
    if n < 2:
        return False
    for i in range(2, int(n ** 0.5) + 1):
        if n % i == 0:
            return False
    return True
