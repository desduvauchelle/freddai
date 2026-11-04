"""Vector/path and timeline helpers adapted from local Tucky Rive authoring source.
No runtime dependency on Tucky. SVG parsing is deliberately limited to this mascot.
"""
import math, re, os


FPS = 60
ART_W, ART_H = 1000, 1230
WORLD_X, WORLD_Y = -130, 10  # original (180,100) -> artboard (50,110): room for hops, squash, dots

_id = [100]
def nid():
    _id[0] += 1
    return f"0:{_id[0]}"

BY_NAME = {}  # name -> element (for animation targets)

# ------------------------------------------------------------------ colours
FUR_STOPS = [("FFDB963E", 0), ("FFB86B23", 0.65), ("FF8B4918", 1)]
GRADS = {
    "fur": FUR_STOPS,
    "cream": [("FFFFF0D5", 0), ("FFF1CA96", 1)],
    "bag": [("FF85863A", 0), ("FF50531E", 1)],
    "stripe": [("FF543010", 0), ("FF8B4B18", 1)],
}
INK = "FF382610"

# ------------------------------------------------------------------ SVG path -> vertices
def parse_path(d):
    toks = re.findall(r"[MLHVQCZmlhvqcz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    i = 0
    subs = []
    cur = None
    pos = (0.0, 0.0)
    cmd = None
    def num():
        nonlocal i
        v = float(toks[i]); i += 1
        return v
    def finish(closed):
        nonlocal cur
        if cur is None:
            return
        pts = cur
        if closed and len(pts) > 1 and abs(pts[0]["p"][0] - pts[-1]["p"][0]) < 1e-6 and abs(pts[0]["p"][1] - pts[-1]["p"][1]) < 1e-6:
            pts[0]["in"] = pts[-1]["in"]
            pts.pop()
        subs.append({"closed": closed, "pts": pts})
        cur = None
    while i < len(toks):
        t = toks[i]
        if re.match(r"[A-Za-z]", t):
            cmd = t; i += 1
            if cmd in "Zz":
                finish(True)
                if subs:
                    pos = subs[-1]["pts"][0]["p"]
                continue
        if cmd == "M":
            finish(False)
            pos = (num(), num())
            cur = [{"p": pos, "in": (0, 0), "out": (0, 0)}]
            cmd = "L"
        elif cmd == "L":
            pos = (num(), num()); cur.append({"p": pos, "in": (0, 0), "out": (0, 0)})
        elif cmd == "H":
            pos = (num(), pos[1]); cur.append({"p": pos, "in": (0, 0), "out": (0, 0)})
        elif cmd == "V":
            pos = (pos[0], num()); cur.append({"p": pos, "in": (0, 0), "out": (0, 0)})
        elif cmd == "Q":
            c = (num(), num()); p = (num(), num())
            p0 = pos
            c1 = (p0[0] + 2 / 3 * (c[0] - p0[0]), p0[1] + 2 / 3 * (c[1] - p0[1]))
            c2 = (p[0] + 2 / 3 * (c[0] - p[0]), p[1] + 2 / 3 * (c[1] - p[1]))
            cur[-1]["out"] = (c1[0] - p0[0], c1[1] - p0[1])
            cur.append({"p": p, "in": (c2[0] - p[0], c2[1] - p[1]), "out": (0, 0)})
            pos = p
        elif cmd == "C":
            c1 = (num(), num()); c2 = (num(), num()); p = (num(), num())
            cur[-1]["out"] = (c1[0] - pos[0], c1[1] - pos[1])
            cur.append({"p": p, "in": (c2[0] - p[0], c2[1] - p[1]), "out": (0, 0)})
            pos = p
        else:
            raise ValueError(f"unsupported path command {cmd} in {d[:40]}")
    finish(False)
    return subs

def ellipse_d(cx, cy, rx, ry):
    k = 0.5522847498
    return (f"M{cx} {cy-ry}C{cx+k*rx} {cy-ry} {cx+rx} {cy-k*ry} {cx+rx} {cy}"
            f"C{cx+rx} {cy+k*ry} {cx+k*rx} {cy+ry} {cx} {cy+ry}"
            f"C{cx-k*rx} {cy+ry} {cx-rx} {cy+k*ry} {cx-rx} {cy}"
            f"C{cx-rx} {cy-k*ry} {cx-k*rx} {cy-ry} {cx} {cy-ry}Z")

def f(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

# ------------------------------------------------------------------ scene graph
class N:
    """A Node (group). pivot is in absolute original coordinates."""
    def __init__(self, name, pivot=(0, 0), kids=None, **props):
        self.name, self.pivot, self.kids, self.props = name, pivot, kids or [], props
        self.id = nid()
        self.clip = None  # name of a clip Shape
        BY_NAME[name] = self

class S:
    """A Shape built from SVG path strings (absolute coords) or parametric ellipse."""
    def __init__(self, name, paths=(), fill=None, stroke=None, sw=17, ell=None, rect=None, dash=None, trim=None,
                 alpha=None, cap="round", **props):
        self.name, self.paths, self.fill, self.stroke, self.sw = name, list(paths), fill, stroke, sw
        self.ell, self.rect, self.dash, self.trim, self.alpha, self.cap, self.props = ell, rect, dash, trim, alpha, cap, props
        self.id = nid()
        self.trim_id = nid() if trim is not None else None
        BY_NAME[name] = self
        if trim is not None:
            BY_NAME[name + ".trim"] = type("T", (), {"id": self.trim_id})()

def color_xml(c, bbox, ind):
    if c in GRADS:
        stops = GRADS[c]
        (x0, y0, x1, y1) = bbox
        w, h = x1 - x0, y1 - y0
        if c == "fur" or c == "bag" or c == "stripe":
            sx, sy, ex, ey = x0 + 0.15 * w, y0 + 0.05 * h, x0 + 0.95 * w, y1
        else:
            sx, sy, ex, ey = x0 + 0.5 * w, y0, x0 + 0.5 * w, y1
        s = f'{ind}<LinearGradient startX="{f(sx)}" startY="{f(sy)}" endX="{f(ex)}" endY="{f(ey)}" name="Gradient">\n'
        for col, pos in stops:
            s += f'{ind}    <GradientStop colorValue="{col}" position="{pos}"/>\n'
        return s + f"{ind}</LinearGradient>\n"
    return f'{ind}<SolidColor colorValue="{c}" name="Color"/>\n'

def emit_vertex(a, ox, oy, ind):
    x, y = a["p"][0] - ox, a["p"][1] - oy
    ix, iy = a["in"]; ox_, oy_ = a["out"]
    if abs(ix) + abs(iy) + abs(ox_) + abs(oy_) < 1e-9:
        return f'{ind}<StraightVertex x="{f(x)}" y="{f(y)}"/>\n'
    return (f'{ind}<CubicDetachedVertex x="{f(x)}" y="{f(y)}" inRotation="{f(math.atan2(iy, ix))}" '
            f'inDistance="{f(math.hypot(ix, iy))}" outRotation="{f(math.atan2(oy_, ox_))}" outDistance="{f(math.hypot(ox_, oy_))}"/>\n')

def emit_shape(s, org, ind):
    ox, oy = org
    out = ""
    attrs = ""
    for k, v in s.props.items():
        attrs += f' {k}="{f(v) if isinstance(v, (int, float)) else v}"'
    if s.ell:
        cx, cy, rx, ry = s.ell
        out += f'{ind}<Shape x="{f(cx-ox)}" y="{f(cy-oy)}"{attrs} name="{s.name}" id="{s.id}">\n'
        out += f'{ind}    <Ellipse width="{f(rx*2)}" height="{f(ry*2)}" name="Path"/>\n'
        bbox = (-rx, -ry, rx, ry)
    elif s.rect:
        cx, cy, w, h, r = s.rect
        out += f'{ind}<Shape x="{f(cx-ox)}" y="{f(cy-oy)}"{attrs} name="{s.name}" id="{s.id}">\n'
        out += f'{ind}    <Rectangle width="{f(w)}" height="{f(h)}" cornerRadiusTL="{f(r)}" name="Path"/>\n'
        bbox = (-w / 2, -h / 2, w / 2, h / 2)
    else:
        out += f'{ind}<Shape{attrs} name="{s.name}" id="{s.id}">\n'
        xs, ys = [], []
        for d in s.paths:
            for sub in parse_path(d):
                closed = "true" if sub["closed"] else "false"
                out += f'{ind}    <PointsPath isClosed="{closed}" name="Path">\n'
                for a in sub["pts"]:
                    out += emit_vertex(a, ox, oy, ind + "        ")
                    xs.append(a["p"][0] - ox); ys.append(a["p"][1] - oy)
                out += f"{ind}    </PointsPath>\n"
        bbox = (min(xs), min(ys), max(xs), max(ys))
    if s.fill:
        out += f'{ind}    <Fill name="Fill">\n' + color_xml(s.fill, bbox, ind + "        ") + f"{ind}    </Fill>\n"
    if s.stroke:
        out += f'{ind}    <Stroke thickness="{f(s.sw)}" cap="{s.cap}" join="round" name="Stroke">\n'
        out += color_xml(s.stroke, bbox, ind + "        ")
        if s.dash:
            out += f'{ind}        <DashPath name="Dashes">\n'
            for L in s.dash:
                out += f'{ind}            <Dash length="{L}" name="Dash"/>\n'
            out += f"{ind}        </DashPath>\n"
        if s.trim is not None:
            out += f'{ind}        <TrimPath start="0" end="{s.trim}" id="{s.trim_id}" name="Trim"/>\n'
        out += f"{ind}    </Stroke>\n"
    out += f"{ind}</Shape>\n"
    return out

DEFAULTS = {}  # filled below, (node, prop) -> value; used both for authoring and mood anim fill

def emit(n, parent_org, ind):
    if isinstance(n, S):
        return emit_shape(n, parent_org, ind)
    px, py = n.pivot
    base = {"x": px - parent_org[0], "y": py - parent_org[1]}
    for (nm, prop), v in DEFAULTS.items():
        if nm == n.name:
            base[prop] = base.get(prop, 0) + v if prop in ("x", "y") else v
    attrs = " ".join(f'{k}="{f(v)}"' for k, v in base.items())
    out = f'{ind}<Node {attrs} name="{n.name}" id="{n.id}">\n'
    if n.clip:
        out += f'{ind}    <ClippingShape sourceId="{BY_NAME[n.clip].id}" name="Clip"/>\n'
    for k in reversed(n.kids):  # SVG painter's order -> Rive front-to-back
        out += emit(k, n.pivot, ind + "    ")
    out += f"{ind}</Node>\n"
    return out


MOOD_PROPS = {}
EASE = {
    "io":    (0.42, 0, 0.58, 1),
    "out":   (0.0, 0.0, 0.2, 1),
    "in":    (0.5, 0, 1, 1),
    "back":  (0.34, 1.7, 0.64, 1),     # ease-out with overshoot
    "back2": (0.3, 2.4, 0.5, 1),       # bigger overshoot
    "inback": (0.5, -0.5, 0.8, 0.4),   # anticipation (pull back then go)
    "soft":  (0.25, 0.1, 0.25, 1),
}

def kf(frame, value, ease="io"):
    return (frame, value, ease)

def tid(name):
    return BY_NAME[name].id

ANIMS = []  # (name, id, xml)

def anim(name, duration, loop, tracks, fill_defaults=True):
    """tracks: {objname: {prop: [kf,...]}}; for mood anims all MOOD_PROPS not mentioned are keyed flat."""
    tracks = {o: dict(p) for o, p in tracks.items()}
    if fill_defaults:
        for (o, p), v in MOOD_PROPS.items():
            tracks.setdefault(o, {})
            if p not in tracks[o]:
                tracks[o][p] = [kf(0, v)]
    aid = nid()
    x = f'        <LinearAnimation loopValue="{loop}" fps="{FPS}" duration="{duration}" name="{name}" id="{aid}">\n'
    for o, props in tracks.items():
        target = BY_NAME[o.split(".")[0]] if "." not in o else BY_NAME[o]
        x += f'            <KeyedObject objectId="{target.id}">\n'
        for p, keys in props.items():
            keys = sorted(keys, key=lambda k: k[0])
            if keys[0][0] != 0:
                dv = MOOD_PROPS.get((o, p), DEFAULTS.get((o, p), 0))
                keys = [kf(0, dv)] + keys
            x += f'                <KeyedProperty property="{p}">\n'
            for (fr, val, ease) in keys:
                if p in ("x", "y") and hasattr(target, "local"):
                    val = val + target.local[0 if p == "x" else 1]
                if ease in ("hold", "linear"):
                    x += f'                    <KeyFrameDouble value="{f(val)}" frame="{fr}" interpolationType="{ease}"/>\n'
                else:
                    a, b, c, d = EASE[ease]
                    x += (f'                    <KeyFrameDouble value="{f(val)}" frame="{fr}" interpolationType="cubic">'
                          f'<CubicEaseInterpolator x1="{a}" y1="{b}" x2="{c}" y2="{d}"/></KeyFrameDouble>\n')
            x += "                </KeyedProperty>\n"
        x += "            </KeyedObject>\n"
    x += "        </LinearAnimation>\n"
    ANIMS.append((name, aid, x))
    return aid

