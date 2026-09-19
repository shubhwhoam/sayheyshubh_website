"""
Adds the PWA <head> tags (manifest link, theme-color, apple touch icon,
favicon) to every .html file in the project root.

Run this once from your project root in Replit's shell:
    python3 add_pwa_tags.py

Safe to re-run - it skips files that already have the manifest tag.
"""
import glob

PWA_HEAD_TAGS = '''    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#4f46e5">
    <link rel="apple-touch-icon" href="/icons/icon-180.png">
    <link rel="icon" type="image/png" href="/icons/favicon-32.png">
'''

def add_tags_to_file(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    if 'rel="manifest"' in content:
        print(f"skip (already has manifest tag): {path}")
        return

    if "</head>" not in content:
        print(f"skip (no </head> found): {path}")
        return

    new_content = content.replace("</head>", PWA_HEAD_TAGS + "</head>", 1)

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"updated: {path}")

if __name__ == "__main__":
    html_files = glob.glob("*.html")
    print(f"Found {len(html_files)} HTML files.\n")
    for path in html_files:
        add_tags_to_file(path)
    print("\nDone.")
