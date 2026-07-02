"""入口脚本"""
from calc import add


def main():
    result = add(2, 3)
    print(f"2 + 3 = {result}")


if __name__ == "__main__":
    main()
