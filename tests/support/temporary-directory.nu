use ../support.nu temporary-directory

def main [prefix: string, fallback: path = ""] {
  temporary-directory $prefix $fallback
}
