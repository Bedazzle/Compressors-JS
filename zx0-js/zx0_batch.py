#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
import time

def process_directory(input_dir, output_dir, zx0_exe, zx0_args=None):
    start_time = time.time()

    if not os.path.isdir(input_dir):
        print(f"Error: Input directory '{input_dir}' does not exist")
        sys.exit(1)

    if not os.path.isfile(zx0_exe):
        print(f"Error: zx0.exe not found at '{zx0_exe}'")
        sys.exit(1)

    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    if zx0_args is None:
        zx0_args = []

    files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
    zx0_files = []

    print(f"Processing {len(files)} files...")
    if zx0_args:
        print(f"Using extra args: {' '.join(zx0_args)}")

    for filename in files:
        input_path = os.path.join(input_dir, filename)
        print(f"Compressing: {filename}")

        try:
            cmd = [zx0_exe] + zx0_args + [input_path]
            subprocess.run(cmd, check=True)
            zx0_files.append(filename + '.zx0')
        except subprocess.CalledProcessError as e:
            print(f"  Error compressing {filename}: {e}")

    print(f"\nMoving {len(zx0_files)} .zx0 files to {output_dir}")

    for zx0_file in zx0_files:
        src = os.path.join(input_dir, zx0_file)
        dst = os.path.join(output_dir, zx0_file)
        if os.path.exists(dst):
            os.remove(dst)
        shutil.move(src, dst)
        print(f"Moved: {zx0_file}")

    elapsed = time.time() - start_time
    print(f"\nDone! Total time: {elapsed:.1f}s")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python zx0_batch.py <input_dir> <output_dir> [zx0_exe] [args...]")
        print("  input_dir  - Directory containing files to compress")
        print("  output_dir - Directory to move .zx0 files to")
        print("  zx0_exe    - Path to zx0.exe (default: ./zx0.exe)")
        print("  args       - Extra arguments for zx0.exe (e.g., -b for backwards)")
        sys.exit(1)

    input_dir = sys.argv[1]
    output_dir = sys.argv[2]

    # Find zx0_exe and any extra args
    zx0_args = []
    zx0_exe = "zx0.exe"

    for arg in sys.argv[3:]:
        if not arg.startswith('-') and not arg.startswith('+'):
            zx0_exe = arg
        else:
            zx0_args.append(arg)

    process_directory(input_dir, output_dir, zx0_exe, zx0_args)
