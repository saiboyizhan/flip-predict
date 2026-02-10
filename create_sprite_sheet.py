#!/usr/bin/env python3
"""
Sprite Sheet 制作工具
将多张图片拼接成一张精灵图
"""

from PIL import Image
import os
import sys

def create_sprite_sheet(image_folder, output_path, frames_per_row=4, padding=0):
    """
    将文件夹中的所有图片拼接成 Sprite Sheet

    参数:
    - image_folder: 包含帧图的文件夹路径
    - output_path: 输出的精灵图路径
    - frames_per_row: 每行放几帧
    - padding: 帧之间的间距（像素）
    """
    print(f"🔍 正在扫描文件夹: {image_folder}")

    # 获取所有图片
    images = []
    filenames = []

    for filename in sorted(os.listdir(image_folder)):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
            img_path = os.path.join(image_folder, filename)
            try:
                img = Image.open(img_path)
                # 转换为 RGBA 模式
                if img.mode != 'RGBA':
                    img = img.convert('RGBA')
                images.append(img)
                filenames.append(filename)
                print(f"  ✓ 加载: {filename} ({img.size[0]}x{img.size[1]})")
            except Exception as e:
                print(f"  ✗ 跳过: {filename} (错误: {e})")

    if not images:
        print("❌ 没有找到有效的图片文件！")
        return False

    print(f"\n📊 找到 {len(images)} 张图片")

    # 检查尺寸是否一致
    sizes = [img.size for img in images]
    if len(set(sizes)) > 1:
        print("⚠️  警告: 图片尺寸不一致！")
        print("   将使用最大尺寸并居中对齐")
        max_width = max(s[0] for s in sizes)
        max_height = max(s[1] for s in sizes)
        frame_width, frame_height = max_width, max_height

        # 调整所有图片到相同尺寸
        adjusted_images = []
        for img in images:
            if img.size != (max_width, max_height):
                new_img = Image.new('RGBA', (max_width, max_height), (0, 0, 0, 0))
                offset_x = (max_width - img.size[0]) // 2
                offset_y = (max_height - img.size[1]) // 2
                new_img.paste(img, (offset_x, offset_y))
                adjusted_images.append(new_img)
            else:
                adjusted_images.append(img)
        images = adjusted_images
    else:
        frame_width, frame_height = images[0].size
        print(f"✓ 所有图片尺寸一致: {frame_width}x{frame_height}")

    # 计算精灵图尺寸
    total_frames = len(images)
    rows = (total_frames + frames_per_row - 1) // frames_per_row

    sprite_width = frame_width * frames_per_row + padding * (frames_per_row - 1)
    sprite_height = frame_height * rows + padding * (rows - 1)

    print(f"\n🎨 创建 Sprite Sheet:")
    print(f"   总帧数: {total_frames}")
    print(f"   每帧尺寸: {frame_width}x{frame_height}")
    print(f"   布局: {frames_per_row} 列 x {rows} 行")
    print(f"   精灵图尺寸: {sprite_width}x{sprite_height}")
    if padding > 0:
        print(f"   帧间距: {padding}px")

    # 创建空白画布
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 粘贴每一帧
    for i, img in enumerate(images):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * (frame_width + padding)
        y = row * (frame_height + padding)
        sprite_sheet.paste(img, (x, y))
        print(f"  ✓ 帧 {i+1}/{total_frames}: 位置 ({x}, {y})")

    # 保存
    sprite_sheet.save(output_path, 'PNG')
    file_size = os.path.getsize(output_path) / 1024  # KB

    print(f"\n✅ Sprite Sheet 创建成功!")
    print(f"   输出文件: {output_path}")
    print(f"   文件大小: {file_size:.2f} KB")

    # 生成使用代码
    print(f"\n📝 在代码中使用:")
    print(f"""
<SpriteAnimation
  spriteSheet="/horse-sprite.png"
  frameWidth={{{frame_width}}}
  frameHeight={{{frame_height}}}
  frameCount={{{total_frames}}}
  framesPerRow={{{frames_per_row}}}
  fps={{12}}
  isPlaying={{true}}
/>
""")

    return True

def main():
    if len(sys.argv) < 2:
        print("使用方法:")
        print("  python create_sprite_sheet.py <图片文件夹> [输出文件] [每行帧数] [间距]")
        print("\n示例:")
        print("  python create_sprite_sheet.py ./horse_frames")
        print("  python create_sprite_sheet.py ./horse_frames horse-sprite.png 4 2")
        return

    image_folder = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "sprite-sheet.png"
    frames_per_row = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    padding = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    if not os.path.exists(image_folder):
        print(f"❌ 文件夹不存在: {image_folder}")
        return

    create_sprite_sheet(image_folder, output_path, frames_per_row, padding)

if __name__ == "__main__":
    main()
