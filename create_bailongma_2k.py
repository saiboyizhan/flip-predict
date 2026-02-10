#!/usr/bin/env python3
"""
白龙马精灵图制作工具 - 2K版本
从115帧中抽取80帧，降低到2K分辨率
"""

from PIL import Image
import os
import sys

def create_sprite_80_frames_2k(image_folder, output_path):
    """
    从115帧中抽取80帧制作精灵图
    降低到2K分辨率 (1920x1080)
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

    # 从115帧中选择80帧（均匀分布）
    target_frames = 80
    frame_indices = []

    if total_frames <= target_frames:
        frame_indices = list(range(total_frames))
    else:
        step = (total_frames - 1) / (target_frames - 1)
        frame_indices = [int(i * step) for i in range(target_frames)]

    print(f"✓ 从 {total_frames} 帧中选择了 {len(frame_indices)} 帧")

    # 目标分辨率
    target_width = 1920
    target_height = 1080
    print(f"✓ 目标分辨率: {target_width}x{target_height} (2K)")

    # 计算精灵图尺寸 (8列 x 10行)
    frames_per_row = 8
    selected_frames_count = len(frame_indices)
    rows = (selected_frames_count + frames_per_row - 1) // frames_per_row

    sprite_width = target_width * frames_per_row
    sprite_height = target_height * rows

    print(f"\n🎨 创建 Sprite Sheet:")
    print(f"   总帧数: {selected_frames_count}")
    print(f"   每帧尺寸: {target_width}x{target_height}")
    print(f"   布局: {frames_per_row} 列 x {rows} 行")
    print(f"   精灵图尺寸: {sprite_width}x{sprite_height}")

    # 创建空白画布
    sprite_sheet = Image.new('RGBA', (sprite_width, sprite_height), (0, 0, 0, 0))

    # 处理每一帧：缩放并粘贴
    for i, frame_idx in enumerate(frame_indices):
        # 获取原始帧
        original_frame = images[frame_idx]

        # 缩放到2K
        resized_frame = original_frame.resize((target_width, target_height), Image.Resampling.LANCZOS)

        # 计算位置
        row = i // frames_per_row
        col = i % frames_per_row
        x = col * target_width
        y = row * target_height

        # 粘贴到画布
        sprite_sheet.paste(resized_frame, (x, y))

        if (i + 1) % 10 == 0:
            print(f"  ✓ 进度: {i+1}/{selected_frames_count}")

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
  frameWidth={{{target_width}}}
  frameHeight={{{target_height}}}
  frameCount={{{selected_frames_count}}}
  framesPerRow={{{frames_per_row}}}
  fps={{10}}
  isPlaying={{true}}
  scale={{0.08}}
/>
""")

    return True

if __name__ == "__main__":
    image_folder = "/Users/xiaobai/pr/6-1"
    output_path = "/Users/xiaobai/Desktop/Premium Horse Racing DApp UI (Copy) 2/horse-sprite-bailongma-2k.png"

    if not os.path.exists(image_folder):
        print(f"❌ 文件夹不存在: {image_folder}")
        sys.exit(1)

    create_sprite_80_frames_2k(image_folder, output_path)
