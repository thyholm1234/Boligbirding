import os
import io
import json
import time
import asyncio
import datetime
import secrets
import hashlib
import requests
import pandas as pd
from dotenv import load_dotenv

from typing import Optional, Dict, Any, List
from collections import defaultdict

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, String, Date, Integer, select

# ---------------------------------------------------------
#  App & Database
# ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

SUPERADMIN = os.environ.get("SUPERADMIN", "")
SUPERADMIN_PASSWORD = os.environ.get("SUPERADMIN_PASSWORD", "")
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./boligbirding.db")

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))    # .../Boligbirding/server
ROOT_DIR   = os.path.dirname(SERVER_DIR)                    # .../Boligbirding
WEB_DIR    = os.path.join(ROOT_DIR, "web")                 # .../Boligbirding/web

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("ADMIN_SECRET", secrets.token_hex(16)))

# ---------------------------------------------------------
#  Models
# ---------------------------------------------------------
class Observation(Base):
    __tablename__ = "observations"
    id         = Column(Integer, primary_key=True, index=True)
    obserkode  = Column(String, index=True)
    artnavn    = Column(String, index=True)
    dato       = Column(Date)
    turid      = Column(String, index=True)
    turtidfra  = Column(String, nullable=True)
    turtidtil  = Column(String, nullable=True)
    turnoter   = Column(String, nullable=True)
    afdeling   = Column(String, nullable=True)   # DOF_afdeling (CSV)
    loknavn    = Column(String, nullable=True)   # Loknavn (CSV)

class Obserkode(Base):
    __tablename__ = "obserkoder"
    id   = Column(Integer, primary_key=True, index=True)
    kode = Column(String, unique=True, index=True)

class GlobalFilter(Base):
    __tablename__ = "globalfilter"
    id    = Column(Integer, primary_key=True, index=True)
    value = Column(String, index=True)

class GlobalYear(Base):
    __tablename__ = "globalyear"
    id    = Column(Integer, primary_key=True, index=True)
    value = Column(Integer, index=True)

class User(Base):
    __tablename__ = "users"
    id            = Column(Integer, primary_key=True, index=True)
    obserkode     = Column(String, unique=True, index=True)
    navn          = Column(String)
    lokalafdeling = Column(String, nullable=True)

class AdminPassword(Base):
    __tablename__ = "adminpassword"
    id           = Column(Integer, primary_key=True, index=True)
    password_hash = Column(String, nullable=False)

# ---------------------------------------------------------
#  Helpers & Constants
# ---------------------------------------------------------
AFDELINGER = [
    "DOF København",
    "DOF Nordsjælland",
    "DOF Vestsjælland",
    "DOF Storstrøm",
    "DOF Bornholm",
    "DOF Fyn",
    "DOF Sønderjylland",
    "DOF Sydvestjylland",
    "DOF Sydøstjylland",
    "DOF Vestjylland",
    "DOF Østjylland",
    "DOF Nordvestjylland",
    "DOF Nordjylland",
]

def safe_makedirs(path: str):
    os.makedirs(path, exist_ok=True)

def get_data_dirs(aar: int):
    base = os.path.join(SERVER_DIR, "data", str(aar))
    scoreboards = os.path.join(base, "scoreboards")
    obser = os.path.join(base, "obser")  # individuelle lister pr. bruger
    return base, scoreboards, obser

def hash_password(p: str) -> str:
    return hashlib.sha256(p.encode("utf-8")).hexdigest()

# ---------------------------------------------------------
#  Global filter & year
# ---------------------------------------------------------
async def get_global_filter() -> str:
    async with SessionLocal() as session:
        row = (await session.execute(select(GlobalFilter).order_by(GlobalFilter.id.desc()))).scalars().first()
        return row.value if row else ""

async def set_global_filter(value: str):
    async with SessionLocal() as session:
        await session.execute(GlobalFilter.__table__.delete())
        session.add(GlobalFilter(value=value.strip()))
        await session.commit()

async def get_global_year() -> int:
    async with SessionLocal() as session:
        row = (await session.execute(select(GlobalYear).order_by(GlobalYear.id.desc()))).scalars().first()
        return row.value if row and row.value else datetime.datetime.now().year

async def set_global_year(value: int):
    async with SessionLocal() as session:
        await session.execute(GlobalYear.__table__.delete())
        session.add(GlobalYear(value=int(value)))
        await session.commit()

# ---------------------------------------------------------
#  First lists (individuelle)
# ---------------------------------------------------------
def _firsts_from_obs(obs_iter: List[Observation]) -> List[Dict[str, Any]]:
    """Første dato pr. hovedart, sorteret kronologisk."""
    firsts: Dict[str, Dict[str, Any]] = {}
    for o in obs_iter:
        navn = (o.artnavn or "").split('(')[0].split(',')[0].strip()
        if "sp." in navn or "/" in navn or " x " in navn:
            continue
        if navn not in firsts or o.dato < firsts[navn]["dato"]:
            firsts[navn] = {"artnavn": navn, "lokalitet": o.loknavn or "", "dato": o.dato}
    return sorted(
        (
            {"artnavn": v["artnavn"], "lokalitet": v["lokalitet"], "dato": v["dato"].strftime("%d-%m-%Y")}
            for v in firsts.values()
        ),
        key=lambda x: datetime.datetime.strptime(x["dato"], "%d-%m-%Y"),
    )

async def generate_user_lists(obserkode: str, aar: int):
    """Skriv globale, matrikel- og lokalafdelings-lister for brugeren (alle afdelinger)."""
    _, _, OBSER_DIR = get_data_dirs(aar)
    safe_makedirs(OBSER_DIR)
    user_dir = os.path.join(OBSER_DIR, obserkode)
    safe_makedirs(user_dir)

    async with SessionLocal() as session:
        q = select(Observation).where(
            Observation.obserkode == obserkode,
            Observation.dato >= datetime.date(aar, 1, 1),
            Observation.dato <= datetime.date(aar, 12, 31),
        )
        obs = (await session.execute(q)).scalars().all()
        filt = await get_global_filter()

    # Global (alle)
    global_list = _firsts_from_obs(obs)
    with open(os.path.join(user_dir, "global.json"), "w", encoding="utf-8") as f:
        json.dump(global_list, f, ensure_ascii=False, indent=2)
    print(f"[LISTS] {obserkode}/{aar}: global.json ({len(global_list)} arter)")

    # Matrikel (filter på Turnoter)
    m_obs = [o for o in obs if filt and filt in (o.turnoter or "")]
    matrikel_list = _firsts_from_obs(m_obs)
    with open(os.path.join(user_dir, "matrikelarter.json"), "w", encoding="utf-8") as f:
        json.dump(matrikel_list, f, ensure_ascii=False, indent=2)
    print(f"[LISTS] {obserkode}/{aar}: matrikelarter.json ({len(matrikel_list)} arter, filter='{filt}')")

    # Lokalafdeling – alle afdelinger
    la_dict: Dict[str, Dict[str, Any]] = {}
    for afd in AFDELINGER:
        la_obs = [o for o in obs if (o.afdeling or "").strip() == afd]
        la_dict[afd] = {
            "alle": _firsts_from_obs(la_obs),
            "matrikel": _firsts_from_obs([o for o in la_obs if filt and filt in (o.turnoter or "")]),
        }
    with open(os.path.join(user_dir, "lokalafdeling.json"), "w", encoding="utf-8") as f:
        json.dump(la_dict, f, ensure_ascii=False, indent=2)
    print(f"[LISTS] {obserkode}/{aar}: lokalafdeling.json for {len(AFDELINGER)} afdelinger")

# ---------------------------------------------------------
#  Scoreboards (fra listerne)
# ---------------------------------------------------------
def _finalize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows.sort(key=lambda x: x["antal_arter"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["placering"] = i
    return rows

def _load_json(path: str):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

async def generate_scoreboards_from_lists(aar: int):
    _, SCOREBOARD_DIR, OBSER_DIR = get_data_dirs(aar)
    safe_makedirs(SCOREBOARD_DIR)

    async with SessionLocal() as session:
        users = (await session.execute(select(User))).scalars().all()

    # Global alle
    ga = []
    for u in users:
        L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "global.json")) or []
        if not L: continue
        last = L[-1]
        ga.append({"navn": u.navn or u.obserkode, "obserkode": u.obserkode,
                   "antal_arter": len(L), "sidste_art": last["artnavn"], "sidste_dato": last["dato"]})
    outdir = os.path.join(SCOREBOARD_DIR, "global_alle"); safe_makedirs(outdir)
    with open(os.path.join(outdir, "scoreboard.json"), "w", encoding="utf-8") as f:
        json.dump(_finalize(ga), f, ensure_ascii=False, indent=2)

    # Global matrikel
    gm = []
    for u in users:
        L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "matrikelarter.json")) or []
        if not L: continue
        last = L[-1]
        gm.append({"navn": u.navn or u.obserkode, "obserkode": u.obserkode,
                   "antal_arter": len(L), "sidste_art": last["artnavn"], "sidste_dato": last["dato"]})
    outdir = os.path.join(SCOREBOARD_DIR, "global_matrikel"); safe_makedirs(outdir)
    with open(os.path.join(outdir, "scoreboard.json"), "w", encoding="utf-8") as f:
        json.dump(_finalize(gm), f, ensure_ascii=False, indent=2)

    # Lokalafdeling (alle + matrikel)
    for afd in AFDELINGER:
        rows_alle, rows_matr = [], []
        for u in users:
            la_map = _load_json(os.path.join(OBSER_DIR, u.obserkode, "lokalafdeling.json")) or {}
            entry = la_map.get(afd) or {}
            L_alle = entry.get("alle") or []
            L_matr = entry.get("matrikel") or []
            if L_alle:
                last = L_alle[-1]
                rows_alle.append({"navn": u.navn or u.obserkode, "obserkode": u.obserkode,
                                  "antal_arter": len(L_alle), "sidste_art": last["artnavn"], "sidste_dato": last["dato"]})
            if L_matr:
                last = L_matr[-1]
                rows_matr.append({"navn": u.navn or u.obserkode, "obserkode": u.obserkode,
                                  "antal_arter": len(L_matr), "sidste_art": last["artnavn"], "sidste_dato": last["dato"]})
        filename = f"{afd.replace(' ', '_')}.json"  # bevar æ/ø/å; kun mellemrum -> _
        outdir_alle = os.path.join(SCOREBOARD_DIR, "lokalafdeling_alle"); safe_makedirs(outdir_alle)
        with open(os.path.join(outdir_alle, filename), "w", encoding="utf-8") as f:
            json.dump(_finalize(rows_alle), f, ensure_ascii=False, indent=2)
        outdir_matr = os.path.join(SCOREBOARD_DIR, "lokalafdeling_matrikel"); safe_makedirs(outdir_matr)
        with open(os.path.join(outdir_matr, filename), "w", encoding="utf-8") as f:
            json.dump(_finalize(rows_matr), f, ensure_ascii=False, indent=2)

# ---------------------------------------------------------
#  DOFbasen sync (CSV -> DB -> lister -> scoreboards)
# ---------------------------------------------------------
async def fetch_and_store(obserkode: str, aar: Optional[int] = None):
    if aar is None:
        aar = await get_global_year()
    filter_ = await get_global_filter()

    # Forsøg HTTP
    url = (
        "https://dofbasen.dk/excel/search_result1.php"
        "?design=excel&soeg=soeg&periode=maanedaar"
        f"&aar_first={aar}&aar_second={aar}"
        "&obstype=observationer&species=alle"
        f"&obserdata={obserkode}&sortering=dato"
    )

    df = None
    try:
        resp = requests.get(url, timeout=12)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.content.decode("latin1")), sep=";", dtype=str)
        print(f"[INFO] Hentet {len(df)} rækker fra DOFbasen for {obserkode}/{aar}")
    except Exception as e:
        print(f"[WARN] HTTP-fejl ({e}) – prøver lokal CSV fallback...")

    # Lokal fallback hvis nødvendigt
    if df is None or df.empty:
        candidates = [
            os.path.join(ROOT_DIR, "search_result (3).csv"),
            os.path.join(SERVER_DIR, "search_result (3).csv"),
        ]
        for p in candidates:
            if os.path.exists(p):
                try:
                    df = pd.read_csv(p, sep=";", dtype=str, encoding="latin1")
                    print(f"[INFO] Lokal CSV: {len(df)} rækker fra {p}")
                    break
                except Exception as e:
                    print(f"[ERROR] Kunne ikke parse {p}: {e}")
        if df is None or df.empty:
            print(f"[ERROR] Ingen data til {obserkode}/{aar}. Skriver tomme lister.")
            await generate_user_lists(obserkode, aar)
            await generate_scoreboards_from_lists(aar)
            return

    # Filter på Turnoter (hvis sat)
    if filter_:
        before = len(df)
        df = df[df["Turnoter"].fillna("").str.contains(filter_)]
        print(f"[INFO] Filter '{filter_}': {before} -> {len(df)} rækker (for {obserkode})")

    # Indsæt i DB
    async with SessionLocal() as session:
        # ryd årets obs for brugeren
        await session.execute(
            Observation.__table__.delete().where(
                Observation.obserkode == obserkode,
                Observation.dato >= datetime.date(aar, 1, 1),
                Observation.dato <= datetime.date(aar, 12, 31),
            )
        )
        await session.commit()

        inserted = 0
        for _, row in df.iterrows():
            raw_dato = (row.get("Dato", "") or "").strip()
            if not raw_dato:
                continue
            if len(raw_dato) > 10:
                raw_dato = raw_dato[:10]
            dato = None
            for fmt in ("%Y-%m-%d", "%d-%m-%Y"):
                try:
                    dato = datetime.datetime.strptime(raw_dato, fmt).date()
                    break
                except Exception:
                    pass
            if not dato:
                continue

            obs = Observation(
                obserkode=row.get("Obserkode", "") or obserkode,
                artnavn=row.get("Artnavn", "") or "",
                dato=dato,
                turid=row.get("Turid"),
                turtidfra=row.get("Turtidfra"),
                turtidtil=row.get("Turtidtil"),
                turnoter=row.get("Turnoter", "") or "",
                afdeling=row.get("DOF_afdeling", "") or "",
                loknavn=row.get("Loknavn", "") or "",
            )
            session.add(obs)
            inserted += 1

        await session.commit()
        print(f"[INFO] Indsat {inserted} observationer for {obserkode}/{aar}")

    # Pipeline: Lister -> Scoreboards
    await generate_user_lists(obserkode, aar)
    await generate_scoreboards_from_lists(aar)

async def daily_update_all_jsons():
    """Opdater alle brugere: sync + build scoreboards."""
    async with SessionLocal() as session:
        koder = [k.kode for k in (await session.execute(select(Obserkode))).scalars().all()]
    aar = await get_global_year()
    for kode in koder:
        print(f"[SYNC ALL] {kode}")
        await fetch_and_store(kode, aar)
        await asyncio.sleep(3)
    print("[SYNC ALL] færdig")

# ---------------------------------------------------------
#  API: Admin
# ---------------------------------------------------------
@app.post("/api/admin_login")
async def admin_login(request: Request, data: Dict[str, Any]):
    password = data.get("password", "")
    async with SessionLocal() as session:
        row = (await session.execute(select(AdminPassword).order_by(AdminPassword.id.desc()))).scalars().first()
        if not row:
            session.add(AdminPassword(password_hash=hash_password(password)))
            await session.commit()
            request.session["is_admin"] = True
            return {"ok": True, "first": True}
        if hash_password(password) == row.password_hash:
            request.session["is_admin"] = True
            return {"ok": True}
        return JSONResponse({"ok": False}, status_code=401)

@app.post("/api/adminlogin")
async def adminlogin(request: Request, data: dict):
    kode = data.get("obserkode", "").strip()
    password = data.get("password", "")
    if kode == SUPERADMIN and password == SUPERADMIN_PASSWORD:
        request.session["is_admin"] = True
        return {"ok": True}
    return JSONResponse({"ok": False, "msg": "Forkert admin-login"}, status_code=401)

@app.get("/api/is_admin")
async def is_admin(request: Request):
    return {"is_admin": bool(request.session.get("is_admin", False))}

@app.post("/api/admin_logout")
async def admin_logout(request: Request):
    request.session.clear()
    return {"ok": True}

# ---------------------------------------------------------
#  API: Global filter & year
# ---------------------------------------------------------
@app.post("/api/set_filter")
async def set_filter_api(filter: str):
    await set_global_filter(filter)
    return {"msg": "Globalt filter opdateret"}

@app.get("/api/get_filter")
async def get_filter_api():
    return {"filter": await get_global_filter()}

@app.post("/api/set_year")
async def set_year_api(year: int):
    await set_global_year(year)
    return {"msg": "Globalt år opdateret"}

@app.get("/api/get_year")
async def get_year_api():
    return {"year": await get_global_year()}

# ---------------------------------------------------------
#  API: Obserkoder
# ---------------------------------------------------------
@app.get("/api/obserkoder")
async def get_obserkoder():
    async with SessionLocal() as session:
        return [{"kode": k.kode} for k in (await session.execute(select(Obserkode))).scalars().all()]

@app.post("/api/add_obserkode")
async def add_obserkode(kode: str, request: Request):
    if not request.session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan tilføje obserkoder")
    async with SessionLocal() as session:
        exists = (await session.execute(select(Obserkode).where(Obserkode.kode == kode))).scalar()
        if exists:
            raise HTTPException(status_code=400, detail="Obserkode findes allerede")
        session.add(Obserkode(kode=kode))
        await session.commit()
    return {"msg": "Obserkode tilføjet"}

@app.delete("/api/delete_obserkode")
async def delete_obserkode(kode: str, request: Request):
    if not request.session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan slette obserkoder")
    async with SessionLocal() as session:
        ok = (await session.execute(select(Obserkode).where(Obserkode.kode == kode))).scalar()
        if not ok:
            raise HTTPException(status_code=404, detail="Obserkode ikke fundet")
        await session.execute(Observation.__table__.delete().where(Observation.obserkode == kode))
        await session.execute(Obserkode.__table__.delete().where(Obserkode.kode == kode))
        await session.commit()
    return {"msg": "Obserkode og data slettet"}

# ---------------------------------------------------------
#  API: Sync
# ---------------------------------------------------------
@app.post("/api/sync_obserkode")
async def sync_obserkode_api(kode: str, aar: Optional[int] = None, background_tasks: BackgroundTasks = None):
    # sikr at bruger findes (navn bruges i scoreboard)
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.obserkode == kode))).scalar()
        if not user:
            session.add(User(obserkode=kode, navn=kode, lokalafdeling=None))
            await session.commit()
        ok = (await session.execute(select(Obserkode).where(Obserkode.kode == kode))).scalar()
        if not ok:
            session.add(Obserkode(kode=kode))
            await session.commit()
    # kør sync nu
    await fetch_and_store(kode, aar)
    return {"msg": f"Sync kørt for {kode}", "aar": aar or (await get_global_year())}

@app.post("/api/sync_all")
async def sync_all_api():
    await daily_update_all_jsons()
    return {"ok": True}

# ---------------------------------------------------------
#  API: Firsts & Scoreboards (filer)
# ---------------------------------------------------------
@app.post("/api/firsts")
async def api_firsts(payload: Dict[str, Any] = Body(...), request: Request = None):
    scope      = payload.get("scope", "global")  # "global" | "matrikel" | "lokalafdeling"
    afdeling   = payload.get("afdeling")
    obserkode  = payload.get("obserkode") or (request.session.get("obserkode") if request else None)
    aar        = payload.get("aar") or await get_global_year()
    if not obserkode:
        raise HTTPException(status_code=401, detail="Ingen obserkode angivet")

    _, _, OBSER_DIR = get_data_dirs(aar)
    user_dir = os.path.join(OBSER_DIR, obserkode)

    if scope == "global":
        path = os.path.join(user_dir, "global.json")
        if not os.path.exists(path):
            await fetch_and_store(obserkode, aar)
        return _load_json(path) or []

    if scope == "matrikel":
        path = os.path.join(user_dir, "matrikelarter.json")
        if not os.path.exists(path):
            await fetch_and_store(obserkode, aar)
        return _load_json(path) or []

    if scope == "lokalafdeling":
        if not afdeling:
            raise HTTPException(status_code=400, detail="Ingen afdeling angivet")
        la = _load_json(os.path.join(user_dir, "lokalafdeling.json")) or {}
        return la.get(afdeling) or {"alle": [], "matrikel": []}

    raise HTTPException(status_code=400, detail="Ukendt scope")

@app.post("/api/scoreboard")
async def api_scoreboard(request: Request):
    params = await request.json()
    scope = params.get("scope")
    aar = params.get("aar") or await get_global_year()

    # Lokalafdeling
    if scope in ("lokal_alle", "lokal_matrikel"):
        afdeling = params.get("afdeling")
        if not afdeling:
            return JSONResponse({"error": "Afdeling mangler"}, status_code=400)
        subdir = "lokalafdeling_alle" if scope == "lokal_alle" else "lokalafdeling_matrikel"
        filename = f"{afdeling.replace(' ', '_')}.json"
        path = os.path.join(SERVER_DIR, "data", str(aar), "scoreboards", subdir, filename)
        if not os.path.exists(path):
            return JSONResponse({"rows": []})
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        return {"rows": rows}

    # Global
    if scope in ("global_alle", "global_matrikel"):
        subdir = "global_alle" if scope == "global_alle" else "global_matrikel"
        path = os.path.join(SERVER_DIR, "data", str(aar), "scoreboards", subdir, "scoreboard.json")
        if not os.path.exists(path):
            return JSONResponse({"rows": []})
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        return {"rows": rows}

    return JSONResponse({"error": "Ukendt scope"}, status_code=400)

@app.post("/api/obser")
async def api_obser(request: Request):
    params = await request.json()
    scope = params.get("scope")
    aar = params.get("aar") or await get_global_year()
    obserkode = params.get("obserkode")
    if not obserkode:
        return JSONResponse({"error": "Obserkode mangler"}, status_code=400)
    userdir = os.path.join(SERVER_DIR, "data", str(aar), "obser", obserkode)

    if scope == "user_global":
        path = os.path.join(userdir, "global.json")
        key = "firsts"
    elif scope == "user_matrikel":
        path = os.path.join(userdir, "matrikelarter.json")
        key = "firsts"
    elif scope == "user_lokalafdeling":
        afdeling = params.get("afdeling")
        path = os.path.join(userdir, "lokalafdeling.json")
        key = "afdeling"
    else:
        return JSONResponse({"error": "Ukendt scope"}, status_code=400)

    if not os.path.exists(path):
        return JSONResponse({key: []})
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if scope == "user_lokalafdeling":
        afdeling = params.get("afdeling")
        return {"firsts": data.get(afdeling, {}).get("alle", [])}
    return {key: data}

# ---------------------------------------------------------
#  API: Bruger-login (DOFbasen) + afdeling
# ---------------------------------------------------------
login_attempts = defaultdict(list)

@app.get("/api/is_logged_in")
async def is_logged_in(request: Request):
    return {"ok": bool(request.session.get("obserkode")), "lokalafdeling": request.session.get("lokalafdeling")}

@app.post("/api/validate-login")
async def validate_login(data: Dict[str, Any] = Body(...), request: Request = None):
    obserkode   = data.get("obserkode")
    adgangskode = data.get("adgangskode")

    # rate limit: max 5 / 10 min pr kode
    now = time.time()
    attempts = [t for t in login_attempts[obserkode] if now - t < 600]
    if len(attempts) >= 5:
        return {"ok": False, "error": "For mange loginforsøg. Prøv igen om 10 minutter."}
    attempts.append(now)
    login_attempts[obserkode] = attempts

    # DOFbasen login
    url = "https://krydslister.dofbasen.dk/api/v1/login"
    try:
        r = requests.post(url, json={"username": obserkode, "password": adgangskode}, timeout=10)
        if r.status_code != 200:
            return {"ok": False, "error": "Login fejlede"}
        token = r.json().get("token")
        if not token:
            return {"ok": False, "error": "Token mangler"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    # Hent navn
    navn = ""
    try:
        navn_res = requests.get(f"https://dofbasen.dk/popobser.php?obserkode={obserkode}", timeout=10)
        if navn_res.status_code == 200:
            html = navn_res.text
            idx = html.find("Navn</acronym>:</td><td valign=\"top\">")
            if idx != -1:
                start = idx + len("Navn</acronym>:</td><td valign=\"top\">")
                end = html.find("</td>", start)
                if end != -1:
                    navn = html[start:end].strip()
    except Exception:
        navn = ""

    # Gem/Opdater bruger
    async with SessionLocal() as session:
        row = (await session.execute(select(User).where(User.obserkode == obserkode))).scalar()
        if row:
            row.navn = navn or row.navn
        else:
            session.add(User(obserkode=obserkode, navn=navn or obserkode))
            session.add(Obserkode(kode=obserkode))
        await session.commit()

    if request:
        request.session["obserkode"]     = obserkode
        request.session["navn"]          = navn
        request.session["lokalafdeling"] = None

    return {"ok": True, "token": token, "navn": navn}

@app.post("/api/set_afdeling")
async def set_afdeling(data: Dict[str, Any] = Body(...), request: Request = None):
    lokalafdeling = data.get("lokalafdeling")
    if not request or not request.session.get("obserkode"):
        raise HTTPException(status_code=401, detail="Ikke logget ind")
    obserkode = request.session.get("obserkode")
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.obserkode == obserkode))).scalar()
        if not user:
            raise HTTPException(status_code=404, detail="Bruger ikke fundet")
        user.lokalafdeling = lokalafdeling
        await session.commit()
    request.session["lokalafdeling"] = lokalafdeling
    return {"ok": True}

# ---------------------------------------------------------
#  API: Matrix (oversigt)
# ---------------------------------------------------------
@app.get("/api/matrix")
async def get_matrix():
    async with SessionLocal() as session:
        rows = (await session.execute(select(Observation))).scalars().all()

    all_arter = set()
    all_koder = set()
    hovedart_data: Dict[str, Dict[str, List[datetime.date]]] = {}
    kode_ture: Dict[str, Dict[str, Any]] = {}
    kode_turid_set: Dict[str, set] = {}

    def hovedart(artnavn: str) -> str:
        return (artnavn or "").split('(')[0].split(',')[0].strip()

    for obs in rows:
        ha = hovedart(obs.artnavn)
        if "sp." in ha or "/" in ha or " x " in ha:
            continue
        all_arter.add(ha)
        all_koder.add(obs.obserkode)
        hovedart_data.setdefault(ha, {}).setdefault(obs.obserkode, []).append(obs.dato)

        if obs.turid and obs.turtidfra and obs.turtidtil:
            kode_ture.setdefault(obs.obserkode, {})[obs.turid] = (obs.turtidfra, obs.turtidtil)
        if obs.turid:
            kode_turid_set.setdefault(obs.obserkode, set()).add(obs.turid)

    arter = sorted(all_arter)
    koder = sorted(all_koder)
    matrix = []
    for art in arter:
        row = []
        for kode in koder:
            datoer = hovedart_data.get(art, {}).get(kode, [])
            row.append(min(datoer).strftime("%d-%m-%Y") if datoer else "")
        matrix.append(row)

    totals = [sum(1 for art in arter if hovedart_data.get(art, {}).get(kode)) for kode in koder]

    def tid_i_min(t1: str, t2: str) -> int:
        try:
            a = datetime.datetime.strptime(t1, "%H:%M")
            b = datetime.datetime.strptime(t2, "%H:%M")
            return max(0, int((b - a).total_seconds() // 60))
        except Exception:
            return 0

    tid_brugt = []
    for kode in koder:
        ture = kode_ture.get(kode, {})
        total = sum(tid_i_min(fra, til) for fra, til in ture.values())
        tid_brugt.append(f"{total//60:02}:{total%60:02}")

    antal_observationer = [len(kode_turid_set.get(kode, set())) for kode in koder]

    return {
        "arter": arter,
        "koder": koder,
        "matrix": matrix,
        "totals": totals,
        "tid_brugt": tid_brugt,
        "antal_observationer": antal_observationer
    }

# ---------------------------------------------------------
#  Startup
# ---------------------------------------------------------
@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[START] DB klar. Static peger på:", WEB_DIR)


@app.post("/api/full_sync_all")
async def full_sync_all():
    asyncio.create_task(daily_update_all_jsons())
    return {"msg": "Fuld synkronisering for alle brugere er startet"}

# ---------------------------------------------------------
#  Static (peg på .../web ved siden af server/)
# ---------------------------------------------------------
if not os.path.isdir(WEB_DIR):
    # fallback hvis nogen kører alt inde i /server
    WEB_DIR = os.path.join(SERVER_DIR, "web")

@app.get("/sw.js")
async def sw():
    sw_path = os.path.join(WEB_DIR, "sw.js")
    if os.path.exists(sw_path):
        return FileResponse(sw_path, media_type="application/javascript")
    return JSONResponse({"ok": False, "msg": "sw.js ikke fundet"}, status_code=404)

@app.get("/")
async def root():
    index_path = os.path.join(WEB_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return JSONResponse({"ok": True, "msg": "Læg index.html i mappen 'web' på roden."})

app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="static")
