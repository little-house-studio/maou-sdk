# Python SDK (`sdk/client.py`)

Python 版 SDK 客户端，用于与 Maou Hub 通信。

---

## 导入

```python
from sdk.client import SDKClient
```

## 构造函数

```python
client = SDKClient(base_url="http://127.0.0.1:8098")
```

## 方法

| 方法 | 说明 |
|------|------|
| `send_message(text)` | 发送消息 |
| `list_sessions()` | 列出所有会话 |
| `create_session()` | 创建新会话 |
| `delete_session(session_id)` | 删除会话 |
| `search(query)` | 搜索 |

## 使用示例

```python
from sdk.client import SDKClient

client = SDKClient(base_url="http://127.0.0.1:8098")

# 发送消息
resp = await client.send_message("hello")
print(resp)

# 会话管理
sessions = await client.list_sessions()
for s in sessions:
    print(f"  {s['id']}: {s.get('title', '无标题')}")

new_session = await client.create_session()
print(f"新会话: {new_session['id']}")

await client.delete_session("old-session-id")

# 搜索
results = await client.search("关键词")
```