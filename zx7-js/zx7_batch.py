#!/usr/bin/env python3
import os
import sys
import shutil
import subprocess
import time

def process_directory(input_dir, output_dir, zx7_exe, zx7_args=None):
    start_time = time.time()
    
    if not os.path.isdir(input_dir):
        print(f"Error: Input directory '{input_dir}' does not exist")
        sys.exit(1)
    
    if not os.path.isfile(zx7_exe):
        print(f"Error: zx7.exe not found at '{zx7_exe}'")
        sys.exit(1)
    
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)
    
    if zx7_args is None:
        zx7_args = []
    
    files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
    zx7_files = []
    
    print(f"Processing {len(files)} files...")
    if zx7_args:
        print(f"Using extra args: {' '.join(zx7_args)}")
    
    for filename in files:
        input_path = os.path.join(input_dir, filename)
        print(f"Compressing: {filename}")
        
        try:
            cmd = [zx7_exe] + zx7_args + [input_path]
            subprocess.run(cmd, check=True)
            zx7_files.append(filename + '.zx7')
        except subprocess.CalledProcessError as e:
            print(f"  Error compressing {filename}: {e}")
    
    print(f"\nMoving {len(zx7_files)} .zx7 files to {output_dir}")
    
    for zx7_file in zx7_files:
        src = os.path.join(input_dir, zx7_file)
        dst = os.path.join(output_dir, zx7_file)
        if os.path.exists(dst):
            os.remove(dst)
        shutil.move(src, dst)
        print(f"Moved: {zx7_file}")
    
    elapsed = time.time() - start_time
    print(f"\nDone! Total time: {elapsed:.1f}s")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python zx7_batch.py <input_dir> <output_dir> [zx7_exe] [args...]")
        print("  input_dir  - Directory containing files to compress")
        print("  output_dir - Directory to move .zx7 files to")
        print("  zx7_exe    - Path to zx7.exe (default: ./zx7.exe)")
        print("  args       - Extra arguments for zx7.exe (e.g., -b for backwards)")
        sys.exit(1)
    
    input_dir = sys.argv[1]
    output_dir = sys.argv[2]
    
    # Find zx7_exe and any extra args
    zx7_args = []
    zx7_exe = "zx7.exe"
    
    for arg in sys.argv[3:]:
        if not arg.startswith('-'):
            zx7_exe = arg
        else:
            zx7_args.append(arg)
    
    process_directory(input_dir, output_dir, zx7_exe, zx7_args)