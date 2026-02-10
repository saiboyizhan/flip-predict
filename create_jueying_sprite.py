#!/usr/bin/env python3
"""
绝影精灵图制作工具
从168帧中选择48帧，保持4K分辨率
"""

from PIL import Image
import os

# 禁用解压炸弹检查
Image.MAX_IMAGE_PIXELS = None

def create_jueying_sprite():
    """创建绝影的精灵图"""

    input_folder = "/Users/xiaobai/pr/4-1"
    output_path = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/public/horse-sprite-jueying.png"

    print("🐎 绝影精灵图制作工具")
    print("=" * 50)
    print(f"📂 输入: {input_folder}")
    print(f"💾 输出: {output_path}")
    print()

    # 获取所有序列帧
    print("🔍 扫描序列帧...")
    all_files = []
    for filename in sorted(os.listdir(input_folder)):
        if filename.startswith("序列 01") and filename.endswith(".png"):
            all_files.append(filename)

    print(f"✓ 找到 {len(all_files)} 帧")

    # 从168帧中均匀选择48帧
    total_frames = len(all_files)
    target_frames = 48

    indices = []
    for i in range(target_frames):
        index = int(i * (total_frames - 1) / (target_frames - 1))
        indices.append(index)

    print(f"\n📊 选择策略:")
    print(f"   原始帧数: {total_frames}")
    print(f"   目标帧数: {target_frames}")

    # 加载选中的帧
    print(f"\n📥 加载帧...")
    images = []
    for i, idx in enumerate(indices):
        filename = all_files[idx]
        img_path = os.path.join(input_folder, filename)
        img = Image.open(img_path)
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        images.append(img)
        if (i + 1) % 10 == 0 or i == len(indices) - 1:
            print(f"  ✓ {i+1}/{target_frames} 帧")

    frame_width, frame_height = images[0].size
    print(f"\n✓ 每帧尺寸: {frame_width}x{frame_height}")

    # 8列布局
    frames_per_row = 8
    rows = (target_frames + frames_per_row - 1) // frames_per_row

    sprite_width = frame_width * frames_per_row
    sprite_height = frame_height * rows

    print(f"\n🎨 精灵图:")
    print(f"   布局: {frames_per_row}列 x {rows}行")
    print(f"   尺寸: {sprite_width}x{sprite_height}")

    # 创建画布
    print("\n📐 拼接...")
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    for i, img in enumerate(images):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(img, (x, y))
        if (i + 1) % 10 == 0 or i == len(images) - 1:
            print(f"  ✓ {i+1}/{target_frames}")

    # 保存
    print("\n💾 保存...")
    sprite_sheet.save(output_path, 'PNG', optimize=True)
    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

    print(f"\n✅ 完成!")
    print(f"   大小: {file_size_mb:.2f} MB")

    return True

if __name__ == "__main__":
    create_jueying_sprite()
