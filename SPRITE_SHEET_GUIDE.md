# Sprite Sheet 制作指南

## 方案 1: 使用在线工具

### 推荐工具：
1. **TexturePacker** (https://www.codeandweb.com/texturepacker)
   - 专业的精灵图打包工具
   - 支持自动优化和裁剪

2. **Shoebox** (https://renderhjs.net/shoebox/)
   - 免费的精灵图工具
   - 简单易用

3. **Leshy SpriteSheet Tool** (https://www.leshylabs.com/apps/sstool/)
   - 在线免费工具
   - 无需安装

## 方案 2: 使用 Python 脚本

我可以帮你写一个 Python 脚本来自动拼接图片：

```python
from PIL import Image
import os

def create_sprite_sheet(image_folder, output_path, frames_per_row=4):
    """
    将文件夹中的所有图片拼接成 Sprite Sheet

    参数:
    - image_folder: 包含帧图的文件夹路径
    - output_path: 输出的精灵图路径
    - frames_per_row: 每行放几帧
    """
    # 获取所有图片
    images = []
    for filename in sorted(os.listdir(image_folder)):
        if filename.endswith(('.png', '.jpg', '.jpeg')):
            img_path = os.path.join(image_folder, filename)
            images.append(Image.open(img_path))

    if not images:
        print("没有找到图片！")
        return

    # 获取单帧尺寸（假设所有帧尺寸相同）
    frame_width, frame_height = images[0].size

    # 计算精灵图尺寸
    total_frames = len(images)
    rows = (total_frames + frames_per_row - 1) // frames_per_row
    sprite_width = frame_width * frames_per_row
    sprite_height = frame_height * rows

    # 创建空白画布
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 粘贴每一帧
    for i, img in enumerate(images):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(img, (x, y))

    # 保存
    sprite_sheet.save(output_path)
    print(f"✅ Sprite Sheet 已创建: {output_path}")
    print(f"   尺寸: {sprite_width}x{sprite_height}")
    print(f"   总帧数: {total_frames}")
    print(f"   每帧尺寸: {frame_width}x{frame_height}")
    print(f"   每行帧数: {frames_per_row}")

# 使用示例
if __name__ == "__main__":
    create_sprite_sheet(
        image_folder="./horse_frames",  # 你的帧图文件夹
        output_path="./horse-sprite.png",  # 输出路径
        frames_per_row=4  # 每行4帧
    )
```

## 使用步骤：

### 1. 准备帧图
- 用 AI 生成 8-12 帧马匹奔跑动画
- 确保所有帧尺寸相同（建议 200x200 或 256x256）
- 命名为 frame_001.png, frame_002.png 等

### 2. 运行脚本
```bash
# 安装依赖
pip install Pillow

# 运行脚本
python create_sprite_sheet.py
```

### 3. 使用生成的 Sprite Sheet
- 将生成的 `horse-sprite.png` 放到 `public` 文件夹
- 在代码中使用

## AI 生成提示词示例：

```
A cute cartoon horse running, side view, 8 frames animation sequence,
consistent style, white background, game sprite, pixel art style,
colorful, playful design
```

或中文：
```
可爱的卡通马匹奔跑动画，侧面视角，8帧序列，
一致的风格，白色背景，游戏精灵图，像素艺术风格，
色彩鲜艳，俏皮设计
```

## 需要我帮你：
1. ✅ 写 Python 脚本（已提供）
2. ⬜ 提供 AI 生成的详细提示词
3. ⬜ 调整动画参数（帧率、缩放等）

你想要哪种方式？
