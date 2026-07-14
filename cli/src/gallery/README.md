# Classical Gallery（ASCII 画廊）

空会话：**MAOU** 像素标 + 居中公版画 + 铭牌。

与配色 `assets/themes/` 分离。

## 当前馆藏（2）

| id | 画作 | 作者 | 年 |
|----|------|------|-----|
| `fallen-angel` | 堕落天使 | 卡巴内尔 | 1847 |
| `dante-virgil` | 但丁与维吉尔 | 布格罗 | 1850 |

## 自行加画

1. 编辑 `assets/gallery-images.json` 增加 `works` 条目  
2. 放入 `src/gallery/works/<id>/source.jpg`（或 `assets/gallery/<id>.jpg`）  
3. 重启 `maou coding` → 自动 bake `sm/md/lg.txt`  

跳过同步：`MAOU_SKIP_GALLERY_SYNC=1`
