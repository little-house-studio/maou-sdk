# 技能需求
## skill类别
- 设计
- 编程
- 思路
- 流程
- 工具
- 图形
- 视频
- 音频
- 其他

## 工具路劲
- god_tools/
    - skill 集合所有skill工具的上帝工具
- find_skill
    - 两个模式：
        - 查找npx skill里面的skill名字，自动按照热度排序
            - 关键词搜索（允许多个关键词数组并鼓励使用多个），返回匹配的skill的全称和介绍列表，数组为返回搜索到的全部结果并去重一次性显示，确保多种写法能保证搜索到准确内容。
        - 下载安装skill（下载到agent所属的.maou目录下的skill目录，不会安装到skill）
            - 参数：skill的全称（从npx skill里面获取）或者具体的完整github地址（从github拉取到skill路径）
    

- create_skill
    - 创建新的skill，参数：
        - skill的名称
        - skill的description
        - skill的详细需求md(200-2000字)：大纲，目的，验收标准，是否有程序代码资源等等
    - 实现过程：
        1. 调用后按照参数生成基础模板，生成skill的代码。
        2. 创建后发送创建后skill的路径结构，以及非常完整创建skill的提示词给ai，让他循环把skill创建好。
        3. 结束创建的loop后，发送有关skill附加文件内内容测试的提示词给ai，让他测试。

- use_skill
    - 参数为已有skill的全称，调用之后，相当于一个read指令阅读那个SKILL.md文件返回，就是业界的惯例做法。
