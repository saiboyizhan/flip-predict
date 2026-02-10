#!/usr/bin/env python3
"""
白龙马精灵图制作工具
从115帧中抽取48帧，保持4K分辨率
"""

from PIL import Image
import os
import sys

def create_sprite_48_frames(image_folder, output_path):
    """
    从115帧中抽取48帧制作精灵图
    保持4K分辨率 (3840x2160)
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
                if img.mode != 'RGBA':
                    img = img.convert('RGBA')
                images.append(img)
                filenames.append(filename)
            except Exception as e:
                print(f"  ✗ 跳过: {filename} (错误: {e})")

    total_frames = len(images)
    print(f"📊 找到 {total_frames} 张图片")

    if total_frames == 0:
        print("❌ 没有找到有效的图片文件！")
        return False

    # 从115帧中选择48帧（均匀分布）
    target_frames = 48
    frame_indices = []

    if total_frames <= target_frames:
        # 如果原始帧数不够，全部使用
        frame_indices = list(range(total_frames))
    else:
        # 均匀分布选择48帧
        step = (total_frames - 1) / (target_frames - 1)
        frame_indices = [int(i * step) for i in range(target_frames)]

    selected_frames = [images[i] for i in frame_indices]
    print(f"✓ 从 {total_frames} 帧中选择了 {len(selected_frames)} 帧")
    print(f"  选择的帧索引: {frame_indices[:10]}... (显示前10个)")

    # 检查尺寸
    frame_width, frame_height = selected_frames[0].size
    print(f"✓ 帧尺寸: {frame_width}x{frame_height} (4K)")

    # 计算精灵图尺寸 (8列 x 6行)
    frames_per_row = 8
    rows = (len(selected_frames) + frames_per_row - 1) // frames_per_row

    sprite_width = frame_width * frames_per_row
    sprite_height = frame_height * rows

    print(f"\n🎨 创建 Sprite Sheet:")
    print(f"   总帧数: {len(selected_frames)}")
    print(f"   每帧尺寸: {frame_width}x{frame_height}")
    print(f"   布局: {frames_per_row} 列 x {rows} 行")
    print(f"   精灵图尺寸: {sprite_width}x{sprite_height}")

    # 创建空白画布
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 粘贴每一帧
    for i, img in enumerate(selected_frames):
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * frame_width
        y = row * frame_height
        sprite_sheet.paste(img, (x, y))
        if (i + 1) % 10 == 0:
            print(f"  ✓ 进度: {i+1}/{len(selected_frames)}")

    # 保存 - 使用高质量压缩
    print(f"\n💾 保存精灵图...")
    sprite_sheet.save(output_path, 'PNG', optimize=True, compress_level=9)

    file_size = os.path.getsize(output_path) / (1024 * 1024)  # MB

    print(f"\n✅ Sprite Sheet 创建成功!")
    print(f"   输出文件: {output_path}")
    print(f"   文件大小: {file_size:.2f} MB")

    # 生成使用代码
    print(f"\n📝 在代码中使用:")
    print(f"""
<SpriteAnimation
  spriteSheet="/horse-sprite-bailongma.png"
  frameWidth={{{frame_width}}}
  frameHeight={{{frame_height}}}
  frameCount={{{len(selected_frames)}}}
  framesPerRow={{{frames_per_row}}}
  fps={{24}}
  isPlaying={{true}}
  scale={{0.04}}
/>
""")

    return True

if __name__ == "__main__":
    image_folder = "/Users/xiaobai/pr/6-1"
    output_path = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/horse-sprite-bailongma.png"

    if not os.path.exists(image_folder):
        print(f"❌ 文件夹不存在: {image_folder}")
        sys.exit(1)

    create_sprite_48_frames(image_folder, output_path)
