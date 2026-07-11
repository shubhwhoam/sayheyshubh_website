import re, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ACTIVE_MAP = {
    'index.html': None,
    'portfolio.html': 'portfolio',
    'digital-marketing-projects.html': 'portfolio',
    'content-writing-projects.html': 'portfolio',
    'Homesick-in-Hostel.html': 'portfolio',
    'art-of-asking.html': 'portfolio',
    'self-awareness-vs-cringe.html': 'portfolio',
    'shoolini-university.html': 'portfolio',
    'blogs.html': 'blogs',
    'beyond-the-clinic-door.html': 'blogs',
    'figuring-out.html': 'blogs',
    'notes.html': 'notes',
    'botany.html': 'notes',
    'botany-years.html': 'notes',
    'microbiology.html': 'notes',
    'microbiology-years.html': 'notes',
    'microbiology-first-year.html': 'notes',
    'microbiology-second-semester.html': 'notes',
    'zoology.html': 'notes',
    # (mapping now points at the real renamed file)
    'zoology-years.html': 'notes',
    'zoology-first-year.html': 'notes',
    'zoology-second-year.html': 'notes',
    'zoology-third-year.html': 'notes',
    'zoology-first-semester.html': 'notes',
    'zoology-second-semester.html': 'notes',
    'zoology-third-semester.html': 'notes',
    'zoology-fourth-semester.html': 'notes',
    'watch-ecology.html': 'notes',
    'watch-non-chordates.html': 'notes',
    'watch-survival-guide.html': 'notes',
    'introduction-to-non-chordates.html': 'notes',
    'about.html': 'about',
    'community.html': 'community',
}

QUESTION_FILES = [f for f in os.listdir(ROOT) if f.endswith('-questions.html')]
for f in QUESTION_FILES:
    ACTIVE_MAP[f] = 'notes'
ACTIVE_MAP['mollusca-question.html'] = 'notes'

NAV_ITEMS = [
    ('notes', 'Notes'),
    ('portfolio', 'Portfolio'),
    ('community', 'Community'),
    ('blogs', 'Blog'),
    ('about', 'About'),
]

def build_nav(active_key):
    lines = ['      <nav>', '        <ul>']
    for href, label in NAV_ITEMS:
        cls = ' class="active"' if href == active_key else ''
        lines.append(f'          <li><a href="{href}"{cls}>{label}</a></li>')
    lines.append('        </ul>')
    lines.append('      </nav>')
    return '\n'.join(lines)

NAV_RE = re.compile(r'<nav>\s*<ul>.*?</ul>\s*</nav>', re.DOTALL)

changed = []
skipped = []

for filename, active_key in ACTIVE_MAP.items():
    path = os.path.join(ROOT, filename)
    if not os.path.exists(path):
        skipped.append((filename, 'missing'))
        continue
    with open(path, 'r', encoding='utf-8') as fh:
        content = fh.read()
    if '<nav>' not in content:
        skipped.append((filename, 'no <nav>'))
        continue
    new_nav = build_nav(active_key)
    new_content, n = NAV_RE.subn(new_nav, content, count=1)
    if n == 0:
        skipped.append((filename, 'pattern not matched'))
        continue
    if new_content != content:
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(new_content)
        changed.append(filename)

print(f"Updated {len(changed)} files")
for f in changed:
    print(" -", f)
print(f"\nSkipped {len(skipped)} files")
for f, reason in skipped:
    print(" -", f, ":", reason)
