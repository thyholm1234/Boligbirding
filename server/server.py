import os
import io
import json
import time
import asyncio
import datetime
import secrets
import math
import hashlib
import requests
import pandas as pd
from dotenv import load_dotenv
import re

from typing import Optional, Dict, Any, List
from collections import defaultdict

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Body, Query, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from html import escape
from passlib.context import CryptContext

SAFE_OBSERKODE_RE = re.compile(r"^[A-Z0-9]{2,16}$")
CSRF_HEADER = "x-csrf-token"
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, String, Date, Integer, select, func

from starlette.middleware.sessions import SessionMiddleware


# ---------------------------------------------------------
#  App & Database
# ---------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

SUPERADMIN = os.environ.get("SUPERADMIN", "")
SUPERADMIN_PASSWORD = os.environ.get("SUPERADMIN_PASSWORD", "")
DATABASE_URL = os.environ.get("DATABASE_URL")

engine = create_async_engine(DATABASE_URL, echo=False, future=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))    # .../Boligbirding/server
ROOT_DIR   = os.path.dirname(SERVER_DIR)                    # .../Boligbirding
WEB_DIR    = os.path.join(ROOT_DIR, "web")                 # .../Boligbirding/web

app = FastAPI()
SESSION_SECRET = os.environ.get("ADMIN_SECRET")
if not SESSION_SECRET:
    # Gør det eksplicit at produktion *kræver* en konstant nøgle
    raise RuntimeError("ADMIN_SECRET mangler. Sæt en fælles, stærk nøgle i miljøet for alle workers.")

app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie=os.environ.get("SESSION_COOKIE", "bb_session"),
    same_site="lax",            # eller "strict" hvis det passer din frontend
    https_only=bool(int(os.environ.get("SESSION_HTTPS_ONLY", "1"))),
    max_age=60*60*24*30,        # 30 dage - tilpas efter behov
)
# ---------------------------------------------------------
#  Models
# ---------------------------------------------------------
class Observation(Base):
    __tablename__ = "observations"
    id         = Column(Integer, primary_key=True, index=True)
    obserkode  = Column(String, index=True)
    artnavn    = Column(String, index=True)
    antal      = Column(Integer, nullable=True)
    dato       = Column(Date)
    turid      = Column(String, index=True)
    obsid      = Column(String, index=True, nullable=True)
    turtidfra  = Column(String, nullable=True)
    turtidtil  = Column(String, nullable=True)
    turnoter   = Column(String, nullable=True)
    afdeling   = Column(String, nullable=True)
    loknavn    = Column(String, nullable=True)

class Lokation(Base):
    __tablename__ = "lokationer"
    id = Column(Integer, primary_key=True)
    site_number = Column(Integer, index=True)
    site_name = Column(String)
    kommune_id = Column(Integer, index=True)

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
    kommune       = Column(String, nullable=True)

class AdminPassword(Base):
    __tablename__ = "adminpassword"
    id           = Column(Integer, primary_key=True, index=True)
    password_hash = Column(String, nullable=False)


def _parse_ddmmyyyy(value: Optional[str]) -> datetime.datetime:
    try:
        return datetime.datetime.strptime(value or "", "%d-%m-%Y")
    except Exception:
        return datetime.datetime.min

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
    return pwd_context.hash(p)

def verify_password(password: str, hashed: str) -> bool:
    if not hashed:
        return False
    if hashed.startswith("$2"):
        return pwd_context.verify(password, hashed)
    return hashlib.sha256(password.encode("utf-8")).hexdigest() == hashed

def generate_csrf_token(session: dict) -> str:
    token = secrets.token_hex(32)
    session["csrf_token"] = token
    return token

def ensure_csrf(request: Request):
    expected = request.session.get("csrf_token")
    provided = request.headers.get(CSRF_HEADER)
    if not expected or not provided or not secrets.compare_digest(expected, provided):
        raise HTTPException(status_code=403, detail="CSRF-beskyttelse fejlede")
    
def normalize_obserkode(kode: str) -> str:
    value = (kode or "").strip().upper()
    if not SAFE_OBSERKODE_RE.fullmatch(value):
        raise ValueError("Ugyldig obserkode")
    return value

def ensure_obserkode_access(request: Request, obserkode: str):
    session = request.session
    if session.get("is_admin"):
        return
    if session.get("obserkode") != obserkode:
        raise HTTPException(status_code=403, detail="Ingen adgang til denne obserkode")

def get_user_dir(aar: int, obserkode: str) -> str:
    _, _, OBSER_DIR = get_data_dirs(aar)
    return os.path.join(OBSER_DIR, normalize_obserkode(obserkode))

def safe_output(value: str) -> str:
    return escape(str(value or ""), quote=True)

def sanitize_text(s):
    """Tillad kun bogstaver, tal og mellemrum."""
    return re.sub(r'[^a-zA-ZæøåÆØÅ0-9 ]', '', str(s or ''))

def resolve_filter_tag(filt: str, aar: int) -> str:
    """
    Returnerer filter-tagget, hvor #BB automatisk får tilføjet de to sidste cifre af årstallet.
    """
    if filt == "#BB":
        return f"#BB{str(aar)[-2:]}"
    return filt

def safe_str(val):
    # Konverterer nan og None til tom string
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return ""
    return str(val)

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
    firsts: Dict[str, Dict[str, Any]] = {}
    for o in obs_iter:
        navn = (o.artnavn or "").split('(')[0].split(',')[0].strip()
        if "sp." in navn or "/" in navn or " x " in navn:
            continue
        if navn not in firsts or o.dato < firsts[navn]["dato"]:
            firsts[navn] = {
                "artnavn": safe_output(navn),
                "lokalitet": safe_output(o.loknavn or ""),
                "dato": o.dato
            }
    return sorted(
        (
            {
                "artnavn": v["artnavn"],
                "lokalitet": v["lokalitet"],
                "dato": v["dato"].strftime("%d-%m-%Y")
            }
            for v in firsts.values()
        ),
        key=lambda x: datetime.datetime.strptime(x["dato"], "%d-%m-%Y"),
    )

async def generate_user_lists(obserkode: str, aar: int):
    obserkode = normalize_obserkode(obserkode)
    _, _, OBSER_DIR = get_data_dirs(aar)
    safe_makedirs(OBSER_DIR)
    user_dir = get_user_dir(aar, obserkode)
    safe_makedirs(user_dir)

    async with SessionLocal() as session:
        q = select(Observation).where(
            Observation.obserkode == obserkode,
            Observation.dato >= datetime.date(aar, 1, 1),
            Observation.dato <= datetime.date(aar, 12, 31),
        )
        obs = (await session.execute(q)).scalars().all()
        filt = await get_global_filter()
    filt = resolve_filter_tag(filt, aar)

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
#  Artsdata
# ---------------------------------------------------------    

@app.get("/api/matrikel_arter")
async def matrikel_arter(
    aar: int = Query(None, description="År (valgfri, default: global year)")
):
    """
    Returnerer en sorteret liste med alle arter i matrikel-listerne.
    """
    if aar is None:
        aar = await get_global_year()
    _, _, OBSER_DIR = get_data_dirs(aar)
    arter = set()
    user_dirs = [os.path.join(OBSER_DIR, d) for d in os.listdir(OBSER_DIR) if os.path.isdir(os.path.join(OBSER_DIR, d))]
    for user_dir in user_dirs:
        path = os.path.join(user_dir, "matrikelarter.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        for row in rows:
            navn = (row.get("artnavn") or "").split("(")[0].split(",")[0].strip()
            if navn:
                arter.add(navn)
    return sorted(arter)

@app.get("/api/artdata")
async def artdata(
    artnavn: str = Query(..., description="Navn på fugleart (præcis, som i listerne)"),
    scope: str = Query("global", description="'global' eller 'matrikel'"),
    aar: int = Query(None, description="År (valgfri, default: global year)")
):
    """
    Returnerer akkumuleret data + statistik for en art,
    samt observationer pr. turid pr. dag og sidste fund pr. matrikel.
    """
    import unicodedata
    if aar is None:
        aar = await get_global_year()
    _, _, OBSER_DIR = get_data_dirs(aar)
    user_dirs = [os.path.join(OBSER_DIR, d) for d in os.listdir(OBSER_DIR) if os.path.isdir(os.path.join(OBSER_DIR, d))]
    ankomstgraf = []
    sidste_fund = []

    artnavn_norm = unicodedata.normalize("NFC", artnavn.strip())

    # 1. Akkumuleret statistik (ankomstgraf) og sidste fund pr. matrikel
    for user_dir in user_dirs:
        if scope == "matrikel":
            path = os.path.join(user_dir, "matrikelarter.json")
        else:
            path = os.path.join(user_dir, "global.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        # Ankomst pr. matrikel (første fund)
        for row in rows:
            navn = (row.get("artnavn") or "").split("(")[0].split(",")[0].strip()
            navn_norm = unicodedata.normalize("NFC", navn)
            if navn_norm == artnavn_norm and row.get("dato"):
                ankomstgraf.append({
                    "matrikel": os.path.basename(user_dir),
                    "ankomst_dato": row["dato"]
                })
                break  # kun første gang brugeren får arten

        # Sidste fund pr. matrikel (kun matrikel)
        if scope == "matrikel":
            datoer_fund = [
                row["dato"] for row in rows
                if unicodedata.normalize("NFC", (row.get("artnavn") or "").split("(")[0].split(",")[0].strip()) == artnavn_norm and row.get("dato")
            ]
            if datoer_fund:
                sidste = max(datoer_fund, key=lambda d: [int(x) for x in d.split('-')[::-1]])
                sidste_fund.append({
                    "matrikel": os.path.basename(user_dir),
                    "sidste_dato": sidste
                })

    # 2. Observationer pr. turid pr. dag (kun for scope == "matrikel")
    obs_per_turid = []
    if scope == "matrikel":
        async with SessionLocal() as session:
            rows = (await session.execute(
                select(
                    Observation.dato,
                    Observation.turid,
                    func.sum(Observation.antal).label("antal")
                )
                .where(
                    func.replace(func.replace(func.replace(Observation.artnavn, "(", ""), ")", ""), ",", "").ilike(f"%{artnavn}%"),
                    Observation.dato >= datetime.date(aar, 1, 1),
                    Observation.dato <= datetime.date(aar, 12, 31)
                )
                .group_by(Observation.dato, Observation.turid)
            )).all()
            # Saml alle observationer pr. dato
            obs_by_date = {}
            for row in rows:
                d = row.dato.strftime("%d-%m-%Y") if row.dato else ""
                if d not in obs_by_date:
                    obs_by_date[d] = {"antal": 0, "turids": set()}
                obs_by_date[d]["antal"] += row.antal or 0
                obs_by_date[d]["turids"].add(row.turid)
            # Lav ratio pr. dato
            obs_per_turid = [
                {
                    "dato": d,
                    "ratio": (v["antal"] / len(v["turids"])) if v["turids"] else 0
                }
                for d, v in sorted(obs_by_date.items())
            ]

    return {
        "ankomstgraf": ankomstgraf,
        "obs_per_turid": obs_per_turid,
        "sidste_fund": sidste_fund
    }

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
    """
    3-trins rebuild fra rigtige lister:
      1) Læs *kun matrikel*-lister -> skriv global_matrikel + lokalafdeling_matrikel
      2) Læs *kun lokal*-lister   -> skriv lokalafdeling_alle
      3) Læs *kun global*-lister  -> skriv global_alle
    Inkluderer alle brugere (også tomme lister) og beregner robust antal + sidste.
    """
    import datetime
    import shutil

    # --- Hjælpere ---
    def _normalize_art(name: str) -> str:
        return (name or "").split("(")[0].split(",")[0].strip()

    def _is_valid_art(name: str) -> bool:
        n = name or ""
        return ("sp." not in n) and ("/" not in n) and (" x " not in n)

    def _parse_dato(d: str) -> datetime.datetime:
        try:
            return datetime.datetime.strptime(d or "", "%d-%m-%Y")
        except Exception:
            return datetime.datetime.min

    def _score_from_list(list_rows):
        """
        list_rows: [{ "artnavn": str, "lokalitet": str, "dato": "dd-mm-YYYY" }, ...]
        Returnerer (antal_arter, sidste_art, sidste_dato) robust.
        Inkluderer alle brugere: tom liste -> (0, "", "").
        """
        if not isinstance(list_rows, list) or not list_rows:
            return 0, "", ""

        cleaned = [r for r in list_rows if r.get("artnavn") and _is_valid_art(r["artnavn"])]
        if not cleaned:
            return 0, "", ""

        unique_arter = {_normalize_art(r["artnavn"]) for r in cleaned}
        antal_arter = len(unique_arter)

        latest = max(cleaned, key=lambda r: _parse_dato(r.get("dato")))
        return antal_arter, latest.get("artnavn", ""), latest.get("dato", "")

    def _safe_clear_dir(path: str):
        if os.path.isdir(path):
            # Ryd hele output-mappen for at starte helt forfra
            shutil.rmtree(path, ignore_errors=True)
        os.makedirs(path, exist_ok=True)

    # --- Stier ---
    _, SCOREBOARD_DIR, OBSER_DIR = get_data_dirs(aar)
    safe_makedirs(SCOREBOARD_DIR)

    # --- Brugere ---
    async with SessionLocal() as session:
        users = [
            u for u in (await session.execute(select(User))).scalars().all()
            if SAFE_OBSERKODE_RE.fullmatch(u.obserkode or "")
        ]

    # ======================================================================
    # 1) MATRIIKEL: global_matrikel + lokalafdeling_matrikel
    # ======================================================================
    outdir_global_matr = os.path.join(SCOREBOARD_DIR, "global_matrikel")
    outdir_lokal_matr  = os.path.join(SCOREBOARD_DIR, "lokalafdeling_matrikel")
    _safe_clear_dir(outdir_global_matr)
    _safe_clear_dir(outdir_lokal_matr)

    # Global matrikel (samlet én fil)
    gm_rows = []
    for u in users:
        L_m = _load_json(os.path.join(OBSER_DIR, u.obserkode, "matrikelarter.json")) or []
        a, art, dato = _score_from_list(L_m)
        gm_rows.append({
            "navn": safe_output(u.navn or u.obserkode),
            "obserkode": u.obserkode,
            "antal_arter": a,
            "sidste_art": safe_output(art),
            "sidste_dato": safe_output(dato),
        })
        print(f"[SB-IN] {u.obserkode} global_matrikel: list={len(L_m)} -> antal={a}, sidste={art} @ {dato}")

    with open(os.path.join(outdir_global_matr, "scoreboard.json"), "w", encoding="utf-8") as f:
        json.dump(_finalize(gm_rows), f, ensure_ascii=False, indent=2)

    # Lokalafdeling matrikel (en fil pr. afdeling)
    for afd in AFDELINGER:
        rows_matr = []
        for u in users:
            la_map = _load_json(os.path.join(OBSER_DIR, u.obserkode, "lokalafdeling.json")) or {}
            L_matr = (la_map.get(afd) or {}).get("matrikel") or []
            a2, art2, dato2 = _score_from_list(L_matr)
            rows_matr.append({
                "navn": u.navn or u.obserkode,
                "obserkode": u.obserkode,
                "antal_arter": a2,
                "sidste_art": art2,
                "sidste_dato": dato2,
            })
            print(f"[SB-IN] {u.obserkode} lokal_matrikel[{afd}]: list={len(L_matr)} -> antal={a2}, sidste={art2} @ {dato2}")

        filename = f"{afd.replace(' ', '_')}.json"
        with open(os.path.join(outdir_lokal_matr, filename), "w", encoding="utf-8") as f:
            json.dump(_finalize(rows_matr), f, ensure_ascii=False, indent=2)

    # ======================================================================
    # 2) LOKAL: lokalafdeling_alle
    # ======================================================================
    outdir_lokal_alle = os.path.join(SCOREBOARD_DIR, "lokalafdeling_alle")
    _safe_clear_dir(outdir_lokal_alle)

    for afd in AFDELINGER:
        rows_alle = []
        for u in users:
            la_map = _load_json(os.path.join(OBSER_DIR, u.obserkode, "lokalafdeling.json")) or {}
            L_alle = (la_map.get(afd) or {}).get("alle") or []
            a1, art1, dato1 = _score_from_list(L_alle)
            rows_alle.append({
                "navn": u.navn or u.obserkode,
                "obserkode": u.obserkode,
                "antal_arter": a1,
                "sidste_art": art1,
                "sidste_dato": dato1,
            })
            print(f"[SB-IN] {u.obserkode} lokal_alle[{afd}]: list={len(L_alle)} -> antal={a1}, sidste={art1} @ {dato1}")

        filename = f"{afd.replace(' ', '_')}.json"
        with open(os.path.join(outdir_lokal_alle, filename), "w", encoding="utf-8") as f:
            json.dump(_finalize(rows_alle), f, ensure_ascii=False, indent=2)

    # ======================================================================
    # 3) GLOBAL: global_alle
    # ======================================================================
    outdir_global_alle = os.path.join(SCOREBOARD_DIR, "global_alle")
    _safe_clear_dir(outdir_global_alle)

    ga_rows = []
    for u in users:
        L_g = _load_json(os.path.join(OBSER_DIR, u.obserkode, "global.json")) or []
        a, art, dato = _score_from_list(L_g)
        ga_rows.append({
            "navn": u.navn or u.obserkode,
            "obserkode": u.obserkode,
            "antal_arter": a,
            "sidste_art": art,
            "sidste_dato": dato,
        })
        print(f"[SB-IN] {u.obserkode} global_alle: list={len(L_g)} -> antal={a}, sidste={art} @ {dato}")

    with open(os.path.join(outdir_global_alle, "scoreboard.json"), "w", encoding="utf-8") as f:
        json.dump(_finalize(ga_rows), f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------
#  DOFbasen sync (CSV -> DB -> lister -> scoreboards)
# ---------------------------------------------------------

async def fetch_and_store(obserkode: str, aar: Optional[int] = None):
    """
    Henter observationer fra DOFbasen (CSV), indsætter ALLE rækker i DB for det angivne år,
    og bygger derefter per-bruger lister + scoreboards for det år.
    """
    import io
    import datetime
    import pandas as pd
    import requests

    obserkode = normalize_obserkode(obserkode)

    if aar is None:
        aar = await get_global_year()
    filter_ = await get_global_filter()
    filter_tag = resolve_filter_tag(filter_, aar)

    url = (
        "https://dofbasen.dk/excel/search_result1.php"
        "?design=excel&soeg=soeg&periode=maanedaar"
        f"&aar_first={aar}&aar_second={aar}"
        "&obstype=observationer&species=alle"
        f"&obserdata={obserkode}&sortering=dato"
    )
    df = None
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.content.decode("latin1")), sep=";", dtype=str)
        print(f"[INFO] Hentet {len(df)} rækker fra DOFbasen for {obserkode} ({aar})")
    except Exception as e:
        print(f"[WARN] HTTP-fejl ({e}) – prøver lokal CSV fallback...")

    # 3) Lokal fallback (valgfri)
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

    # 4) Ingen data -> skriv tomme lister og scoreboards for det valgte år
    if df is None or df.empty:
        print(f"[ERROR] Ingen data til {obserkode}/{aar}. Skriver tomme lister.")
        await generate_user_lists(obserkode, aar)
        await generate_scoreboards_from_lists(aar)
        return

    # 5) (INFO) Vis hvad admin-filter ville give—men ANVEND DET IKKE på CSV -> DB
    if filter_tag:
        try:
            before = len(df)
            after = len(df[df["Turnoter"].fillna("").str.contains(filter_tag)])
            print(f"[INFO] (info) Filter '{filter_tag}': {before} -> {after} rækker (for {obserkode}) [ikke anvendt til DB]")
        except Exception:
            pass

    # 6) Indsæt ALLE rækker i DB for det valgte år (rydder ALT for brugeren for det år) - batch-inserts
    BATCH_SIZE = 25000
    start_date = datetime.date(aar, 1, 1)
    end_date = datetime.date(aar, 12, 31)
    async with SessionLocal() as session:
        await session.execute(
            Observation.__table__.delete().where(
                Observation.obserkode == obserkode,
                Observation.dato >= start_date,
                Observation.dato <= end_date
            )
        )
        await session.commit()

        inserted = 0
        batch = []
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
            if not dato or not (start_date <= dato <= end_date):
                continue

            antal = int(row.get("Antal", "") or 0)
            if antal == 0:
                continue

            row_obserkode = row.get("Obserkode", obserkode) or obserkode
            try:
                row_obserkode = normalize_obserkode(row_obserkode)
            except ValueError:
                row_obserkode = obserkode
            obs = Observation(
                obserkode=row_obserkode,
                artnavn=safe_str(row.get("Artnavn", "") or ""),
                dato=dato,
                turid=safe_str(row.get("Turid")),
                obsid=safe_str(row.get("Obsid")) if "Obsid" in row else None,
                turtidfra=safe_str(row.get("Turtidfra")),
                turtidtil=safe_str(row.get("Turtidtil")),
                turnoter=safe_str(row.get("Turnoter", "") or ""),
                afdeling=safe_str(row.get("DOF_afdeling", "") or ""),
                loknavn=safe_str(row.get("Loknavn", "") or ""),
                antal=antal
            )
            batch.append(obs)
            inserted += 1
            if len(batch) >= BATCH_SIZE:
                session.add_all(batch)
                await session.commit()
                batch = []
        if batch:
            session.add_all(batch)
            await session.commit()
        print(f"[INFO] Indsat {inserted} observationer for {obserkode} ({aar})")

    # 7) Generér lister og scoreboards kun for det valgte år
    await generate_user_lists(obserkode, aar)
    await generate_scoreboards_from_lists(aar)

async def fetch_and_store_sites_for_kommune(kommune_id: int):
    url = f"https://statistik.dofbasen.dk/sites/group_{kommune_id}.json"
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        sites = resp.json()
    except Exception as e:
        print(f"[ERROR] Kunne ikke hente sites for kommune {kommune_id}: {e}")
        return

    async with SessionLocal() as session:
        # Slet eksisterende sites for denne kommune
        await session.execute(
            Lokation.__table__.delete().where(Lokation.kommune_id == kommune_id)
        )
        # Indsæt nye
        for site in sites:
            session.add(Lokation(
                site_number=site["siteNumber"],
                site_name=site["siteName"],
                kommune_id=kommune_id
            ))
        await session.commit()
    print(f"[INFO] Opdateret {len(sites)} lokationer for kommune {kommune_id}")

async def update_all_kommuner_sites():
    kommuner_path = os.path.join(SERVER_DIR, "kommuner.csv")
    ids = []
    with open(kommuner_path, encoding="utf-8") as f:
        next(f)  # skip header
        for line in f:
            if ";" in line:
                kommune_id = int(line.strip().split(";")[0])
                ids.append(kommune_id)
    for kommune_id in ids:
        await fetch_and_store_sites_for_kommune(kommune_id)

@app.post("/api/update_lokationer")
async def update_lokationer(request: Request):
    # Kun superadmin må opdatere lokationer
    admin_koder = [k.strip() for k in os.environ.get("SUPERADMIN", "").split(",") if k.strip()]
    session = request.session
    obserkode = session.get("obserkode")
    if not (obserkode and obserkode in admin_koder):
        raise HTTPException(status_code=403, detail="Kun superadmin kan opdatere lokationer")
    await update_all_kommuner_sites()
    return {"msg": "Alle lokationer opdateret"}

async def daily_update_all_jsons():
    """
    Daglig fuld synkronisering:
    1. Hent og indsæt ALLE observationer for ALLE brugere (1900-NU) direkte.
    2. Generér lister og scoreboards for ALLE år med data (cacher alle år).
    """
    import io
    import datetime
    import pandas as pd
    import requests

    BATCH_SIZE = 25000

    # 1. Hent alle brugerkoder
    async with SessionLocal() as session:
        koder = [
            normalize_obserkode(k.kode)
            for k in (await session.execute(select(Obserkode))).scalars().all()
            if SAFE_OBSERKODE_RE.fullmatch((k.kode or "").strip().upper())
        ]

    # 2. Hent og indsæt observationer for alle brugere (rydder ALT for brugeren først)
    for kode in koder:
        print(f"[DAILY SYNC] Henter og indsætter observationer for {kode}")
        url = (
            "https://dofbasen.dk/excel/search_result1.php"
            "?design=excel&soeg=soeg&periode=maanedaar"
            f"&aar_first=1900&aar_second={datetime.datetime.now().year}"
            "&obstype=observationer&species=alle"
            f"&obserdata={kode}&sortering=dato"
        )
        df = None
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            df = pd.read_csv(io.StringIO(resp.content.decode("latin1")), sep=";", dtype=str)
            print(f"[INFO] Hentet {len(df)} rækker fra DOFbasen for {kode} (1900-NU)")
        except Exception as e:
            print(f"[WARN] HTTP-fejl ({e}) – prøver lokal CSV fallback...")
            df = None

        # Lokal fallback (valgfri)
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

        # Indsæt i DB (ryd ALT for brugeren først) - nu med batch-inserts
        async with SessionLocal() as session:
            await session.execute(
                Observation.__table__.delete().where(
                    Observation.obserkode == kode
                )
            )
            await session.commit()

            inserted = 0
            batch = []
            if df is not None and not df.empty:
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

                    antal = int(row.get("Antal", "") or 0)
                    if antal == 0:
                        continue

                    obs = Observation(
                        obserkode=safe_str(row.get("Obserkode", "")),
                        artnavn=safe_str(row.get("Artnavn", "") or ""),
                        dato=dato,
                        turid=safe_str(row.get("Turid")),
                        obsid=safe_str(row.get("Obsid")) if "Obsid" in row else None,
                        turtidfra=safe_str(row.get("Turtidfra")),
                        turtidtil=safe_str(row.get("Turtidtil")),
                        turnoter=safe_str(row.get("Turnoter", "") or ""),
                        afdeling=safe_str(row.get("DOF_afdeling", "") or ""),
                        loknavn=safe_str(row.get("Loknavn", "") or ""),
                        antal=antal
                    )
                    batch.append(obs)
                    inserted += 1
                    if len(batch) >= BATCH_SIZE:
                        session.add_all(batch)
                        await session.commit()
                        batch = []
                if batch:
                    session.add_all(batch)
                    await session.commit()
            print(f"[INFO] Indsat {inserted} observationer for {kode} (1900-NU)")

    print("[DAILY SYNC] Alle observationer hentet og indsat.")

    # 3. Find alle årstal med data på tværs af brugere
    async with SessionLocal() as session:
        years = (await session.execute(
            select(func.extract("year", Observation.dato)).distinct()
        )).scalars().all()
        years = [int(y) for y in years if y is not None]

        # Find alle brugere igen (til generate_user_lists)
        brugere = [u.obserkode for u in (await session.execute(select(User))).scalars().all()]

    # 4. Generér lister og scoreboards for alle år og alle brugere
    for aar in sorted(years):
        for kode in brugere:
            await generate_user_lists(kode, aar)
        await generate_scoreboards_from_lists(aar)
        print(f"[DAILY SYNC] Scoreboards og lister genereret for {aar}")

    print("[DAILY SYNC] Færdig med scoreboards og lister for alle år.")


# ---------------------------------------------------------
#  API: Admin
# ---------------------------------------------------------
@app.post("/api/admin_login")
async def admin_login(request: Request, data: Dict[str, Any]):
    password = data.get("password", "")
    session = request.session
    async with SessionLocal() as dbsession:
        row = (await dbsession.execute(select(AdminPassword).order_by(AdminPassword.id.desc()))).scalars().first()
        if not row:
            dbsession.add(AdminPassword(password_hash=hash_password(password)))
            await dbsession.commit()
            session["is_admin"] = True
            token = generate_csrf_token(session)
            return {"ok": True, "first": True, "csrf_token": token}
        if verify_password(password, row.password_hash):
            if not row.password_hash.startswith("$2"):
                row.password_hash = hash_password(password)
                await dbsession.commit()
            session["is_admin"] = True
            token = generate_csrf_token(session)
            return {"ok": True, "csrf_token": token}
        return JSONResponse({"ok": False}, status_code=401)

@app.post("/api/adminlogin")
async def adminlogin(request: Request, data: dict):
    kode = data.get("obserkode", "").strip()
    password = data.get("password", "")
    session = request.session
    if kode == SUPERADMIN and password == SUPERADMIN_PASSWORD:
        session["is_admin"] = True
        token = generate_csrf_token(session)
        return {"ok": True, "csrf_token": token}
    return JSONResponse({"ok": False, "msg": "Forkert admin-login"}, status_code=401)

@app.get("/api/is_admin")
async def is_admin(request: Request):
    session = request.session
    return {"is_admin": bool(session.get("is_admin", False))}

@app.post("/api/admin_logout")
async def admin_logout(request: Request):
    session = request.session
    session.clear()
    return {"ok": True}

@app.get("/api/obser_is_admin")
async def obser_is_admin(request: Request):
    """
    Returnér om brugeren er admin (tjekker både session, .env og database).
    """
    session = request.session
    obserkode = session.get("obserkode")
    admin_koder = [k.strip() for k in os.environ.get("SUPERADMIN", "").split(",") if k.strip()]
    # Først: tjek om obserkode matcher admin_koder
    if obserkode and obserkode in admin_koder:
        return {"is_admin": True}
    # Ellers: tjek om bruger er markeret som admin i databasen
    if obserkode:
        async with SessionLocal() as dbsession:
            user = (await dbsession.execute(select(User).where(User.obserkode == obserkode))).scalar_one_or_none()
            if user and getattr(user, "is_admin", False):
                return {"is_admin": True}
    return {"is_admin": False}

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
        return [
            {"kode": u.obserkode, "navn": u.navn}
            for u in (await session.execute(select(User))).scalars().all()
        ]

@app.post("/api/add_obserkode")
async def add_obserkode(kode: str, request: Request):
    session = request.session
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan tilføje obserkoder")
    async with SessionLocal() as dbsession:
        exists = (await dbsession.execute(select(Obserkode).where(Obserkode.kode == kode))).scalar()
        if exists:
            raise HTTPException(status_code=400, detail="Obserkode findes allerede")
        dbsession.add(Obserkode(kode=kode))
        # Opret også User hvis den ikke findes
        user_exists = (await dbsession.execute(select(User).where(User.obserkode == kode))).scalar()
        if not user_exists:
            dbsession.add(User(obserkode=kode, navn=kode, lokalafdeling=None))
        await dbsession.commit()
    return {"msg": "Obserkode og bruger tilføjet"}

@app.delete("/api/delete_obserkode")
async def delete_obserkode(kode: str, request: Request):
    session = request.session
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan slette obserkoder")
    async with SessionLocal() as session:
        # Tjek om brugeren findes i mindst én af tabellerne
        ok = (await session.execute(select(Obserkode).where(Obserkode.kode == kode))).scalar()
        user = (await session.execute(select(User).where(User.obserkode == kode))).scalar()
        if not ok and not user:
            raise HTTPException(status_code=404, detail="Obserkode ikke fundet")
        # Slet alle observationer
        await session.execute(Observation.__table__.delete().where(Observation.obserkode == kode))
        # Slet fra Obserkode
        await session.execute(Obserkode.__table__.delete().where(Obserkode.kode == kode))
        # Slet fra User
        await session.execute(User.__table__.delete().where(User.obserkode == kode))
        await session.commit()
    # Fjern brugeren fra alle grupper (i grupper.json)
    grupper = load_grupper()
    for g in grupper:
        if kode in g.get("obserkoder", []):
            g["obserkoder"] = [k for k in g["obserkoder"] if k != kode]
    save_grupper(grupper)
    return {"msg": "Obserkode, bruger og alle data slettet"}

@app.get("/api/afdelinger")
async def afdelinger():
    def read_csv_names(filepath):
        if not os.path.exists(filepath):
            return []
        with open(filepath, encoding="utf-8") as f:
            lines = f.readlines()
        # Skip header, return only 'navn' column
        return [line.strip().split(";")[1] for line in lines[1:] if ";" in line]

    kommuner_path = os.path.join(SERVER_DIR, "kommuner.csv")
    afdelinger_path = os.path.join(SERVER_DIR, "lokalafdelinger.csv")

    kommuner = read_csv_names(kommuner_path)
    afdelinger = read_csv_names(afdelinger_path)

    return {
        "kommuner": kommuner,
        "lokalafdelinger": afdelinger
    }

@app.get("/api/get_userprefs")
async def get_userprefs(request: Request):
    session = request.session
    obserkode = session.get("obserkode")
    if not obserkode:
        return {"lokalafdeling": None, "kommune": None, "obserkode": None, "navn": None}
    async with SessionLocal() as session:
        user = (await session.execute(select(User).where(User.obserkode == obserkode))).scalar_one_or_none()
        if user:
            return {
                "lokalafdeling": user.lokalafdeling,
                "kommune": getattr(user, "kommune", None),
                "obserkode": user.obserkode,
                "navn": user.navn
            }
    return {"lokalafdeling": None, "kommune": None, "obserkode": None, "navn": None}

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
    return {"ok": True, "msg": "Synkronisering for alle brugere er gennemført"}

@app.post("/api/sync_mine_observationer")
async def sync_mine_observationer(request: Request, aar: Optional[int] = None):
    """
    Synkroniserer observationer for den aktuelle bruger (kræver login).
    """
    session = request.session
    obserkode = session.get("obserkode")
    if not obserkode:
        raise HTTPException(status_code=401, detail="Ikke logget ind")
    if aar is None:
        aar = await get_global_year()
    await fetch_and_store(obserkode, aar)
    return {"ok": True, "msg": f"Synkronisering gennemført for {obserkode} ({aar})"}

# ---------------------------------------------------------
#  API: Firsts & Scoreboards (filer)
# ---------------------------------------------------------
@app.post("/api/firsts")
async def api_firsts(payload: Dict[str, Any] = Body(...), request: Request = None):
    scope      = payload.get("scope", "global")  # "global" | "matrikel" | "lokalafdeling"
    afdeling   = payload.get("afdeling")
    session = request.session if request else None
    obserkode  = payload.get("obserkode") or (session.get("obserkode") if session else None)
    aar        = payload.get("aar") or await get_global_year()
    if not obserkode:
        raise HTTPException(status_code=401, detail="Ingen obserkode angivet")

    _, _, OBSER_DIR = get_data_dirs(aar)
    user_dir = os.path.join(OBSER_DIR, obserkode)

    def filter_nonempty(lst):
        # Fjern brugere uden observationer (tom liste eller kun tomme felter)
        return [row for row in lst if row.get("artnavn") or row.get("dato")]

    if scope == "global":
        path = os.path.join(user_dir, "global.json")
        if not os.path.exists(path):
            await fetch_and_store(obserkode, aar)
        data = _load_json(path) or []
        return filter_nonempty(data)

    if scope == "matrikel":
        path = os.path.join(user_dir, "matrikelarter.json")
        if not os.path.exists(path):
            await fetch_and_store(obserkode, aar)
        data = _load_json(path) or []
        return filter_nonempty(data)

    if scope == "lokalafdeling":
        if not afdeling:
            raise HTTPException(status_code=400, detail="Ingen afdeling angivet")
        la = _load_json(os.path.join(user_dir, "lokalafdeling.json")) or {}
        afd_data = la.get(afdeling) or {"alle": [], "matrikel": []}
        afd_data["alle"] = filter_nonempty(afd_data.get("alle", []))
        afd_data["matrikel"] = filter_nonempty(afd_data.get("matrikel", []))
        return afd_data

    raise HTTPException(status_code=400, detail="Ukendt scope")

@app.post("/api/scoreboard")
async def api_scoreboard(request: Request):
    params = await request.json()
    scope = params.get("scope")
    aar = params.get("aar") or await get_global_year()

    def filter_nonempty(rows):
        # Fjern brugere med 0 arter
        return [r for r in rows if r.get("antal_arter", 0) > 0]

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
        return {"rows": filter_nonempty(rows)}

    # Global
    if scope in ("global_alle", "global_matrikel"):
        subdir = "global_alle" if scope == "global_alle" else "global_matrikel"
        path = os.path.join(SERVER_DIR, "data", str(aar), "scoreboards", subdir, "scoreboard.json")
        if not os.path.exists(path):
            return JSONResponse({"rows": []})
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        return {"rows": filter_nonempty(rows)}

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

@app.get("/api/user_scoreboard")
async def user_scoreboard(request: Request, aar: int = Query(None)):
    """
    Returnerer brugerens placering, antal arter, seneste art og dato for:
    - Lokalafdeling (hvis sat): alle + matrikel
    - Nationalt: alle + matrikel
    - Grupper: alle + matrikel (samme format)
    Med debug-logging.
    """
    session = request.session
    obserkode = session.get("obserkode")
    print("[DEBUG] Session obserkode:", obserkode)
    if not obserkode:
        raise HTTPException(status_code=401, detail="Ikke logget ind")
    if aar is None:
        aar = await get_global_year()
    print("[DEBUG] År:", aar)
    _, SCOREBOARD_DIR, OBSER_DIR = get_data_dirs(aar)
    print("[DEBUG] SCOREBOARD_DIR:", SCOREBOARD_DIR)

    def get_row(rows):
        for i, r in enumerate(rows, 1):
            print("[DEBUG] Tjekker row:", r)
            if r.get("obserkode") == obserkode:
                print("[DEBUG] Match fundet:", r)
                return {
                    "placering": r.get("placering", i),
                    "antal_arter": r.get("antal_arter", 0),
                    "sidste_art": r.get("sidste_art", ""),
                    "sidste_dato": r.get("sidste_dato", "")
                }
        print("[DEBUG] Ingen match for obserkode:", obserkode)
        return None

    result = {}

    # Nationalt - alle
    try:
        path = os.path.join(SCOREBOARD_DIR, "global_alle", "scoreboard.json")
        print("[DEBUG] Læser national_alle fra:", path)
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        result["national_alle"] = get_row(rows)
    except Exception as e:
        print("[DEBUG] national_alle fejl:", e)
        result["national_alle"] = None

    # Nationalt - matrikel
    try:
        path = os.path.join(SCOREBOARD_DIR, "global_matrikel", "scoreboard.json")
        print("[DEBUG] Læser national_matrikel fra:", path)
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        result["national_matrikel"] = get_row(rows)
    except Exception as e:
        print("[DEBUG] national_matrikel fejl:", e)
        result["national_matrikel"] = None

    # Lokalafdeling (hent fra session eller database)
    lokalafdeling = session.get("lokalafdeling")
    print("[DEBUG] Session lokalafdeling:", lokalafdeling)
    if not lokalafdeling:
        async with SessionLocal() as dbsession:
            user = (await dbsession.execute(select(User).where(User.obserkode == obserkode))).scalar_one_or_none()
            if user and user.lokalafdeling:
                lokalafdeling = user.lokalafdeling
                session["lokalafdeling"] = lokalafdeling
                print("[DEBUG] Lokalafdeling hentet fra database:", lokalafdeling)
    if lokalafdeling:
        try:
            filename = f"{lokalafdeling.replace(' ', '_')}.json"
            path = os.path.join(SCOREBOARD_DIR, "lokalafdeling_alle", filename)
            print("[DEBUG] Læser lokalafdeling_alle fra:", path)
            with open(path, encoding="utf-8") as f:
                rows = json.load(f)
            result["lokalafdeling_alle"] = get_row(rows)
        except Exception as e:
            print("[DEBUG] lokalafdeling_alle fejl:", e)
            result["lokalafdeling_alle"] = None
        try:
            filename = f"{lokalafdeling.replace(' ', '_')}.json"
            path = os.path.join(SCOREBOARD_DIR, "lokalafdeling_matrikel", filename)
            print("[DEBUG] Læser lokalafdeling_matrikel fra:", path)
            with open(path, encoding="utf-8") as f:
                rows = json.load(f)
            result["lokalafdeling_matrikel"] = get_row(rows)
        except Exception as e:
            print("[DEBUG] lokalafdeling_matrikel fejl:", e)
            result["lokalafdeling_matrikel"] = None
    else:
        print("[DEBUG] Ingen lokalafdeling sat i session eller database.")
        result["lokalafdeling_alle"] = None
        result["lokalafdeling_matrikel"] = None

    # Grupper (beregn direkte)
    async def beregn_gruppe_scoreboard(gruppe, scope, aar):
        koder = gruppe.get("obserkoder", [])
        rows = []
        async with SessionLocal() as session:
            users = (await session.execute(select(User).where(User.obserkode.in_(koder)))).scalars().all()
        for u in users:
            if scope == "gruppe_alle":
                L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "global.json")) or []
            elif scope == "gruppe_matrikel":
                L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "matrikelarter.json")) or []
            else:
                continue
            a, art, dato = 0, "", ""
            if L:
                unique_arter = { (r.get("artnavn") or "").split("(")[0].split(",")[0].strip()
                                 for r in L if r.get("artnavn") and "sp." not in r.get("artnavn") and "/" not in r.get("artnavn") and " x " not in r.get("artnavn") }
                a = len(unique_arter)
                latest = max(L, key=lambda r: _parse_ddmmyyyy(r.get("dato")), default={})
                art = latest.get("artnavn", "")
                dato = latest.get("dato", "")
            rows.append({
                "navn": u.navn or u.obserkode,
                "obserkode": u.obserkode,
                "antal_arter": a,
                "sidste_art": art,
                "sidste_dato": dato,
            })
        rows.sort(key=lambda x: x["antal_arter"], reverse=True)
        for i, r in enumerate(rows, 1):
            r["placering"] = i
        return rows

    grupper = load_grupper()
    mine_grupper = [g for g in grupper if obserkode in g.get("obserkoder", [])]
    print("[DEBUG] Mine grupper:", [g["navn"] for g in mine_grupper])
    result["grupper"] = []
    for g in mine_grupper:
        gruppeinfo = {"navn": g["navn"]}
        # alle
        try:
            rows_alle = await beregn_gruppe_scoreboard(g, "gruppe_alle", aar)
            gruppeinfo["alle"] = get_row(rows_alle)
        except Exception as e:
            print("[DEBUG] gruppe_alle fejl:", e)
            gruppeinfo["alle"] = None
        # matrikel
        try:
            rows_matrikel = await beregn_gruppe_scoreboard(g, "gruppe_matrikel", aar)
            gruppeinfo["matrikel"] = get_row(rows_matrikel)
        except Exception as e:
            print("[DEBUG] gruppe_matrikel fejl:", e)
            gruppeinfo["matrikel"] = None
        result["grupper"].append(gruppeinfo)

    print("[DEBUG] Endeligt resultat:", result)
    return result

# ---------------------------------------------------------
#  API: Bruger-login (DOFbasen) + afdeling
# ---------------------------------------------------------
login_attempts = defaultdict(list)

@app.get("/api/is_logged_in")
async def is_logged_in(request: Request):
    session = request.session
    return {"ok": bool(session.get("obserkode")), "lokalafdeling": session.get("lokalafdeling")}

# filepath: [server.py](http://_vscodecontentref_/1)
@app.post("/api/validate-login")
async def validate_login(data: Dict[str, Any] = Body(...), request: Request = None):
    try:
        obserkode = normalize_obserkode(data.get("obserkode"))
    except ValueError:
        return {"ok": False, "error": "Ugyldig obserkode"}
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
        user = (await session.execute(select(User).where(User.obserkode == obserkode))).scalar()
        if user:
            if navn and user.navn != navn:
                user.navn = navn
        else:
            session.add(User(obserkode=obserkode, navn=navn or obserkode))
        # Sørg for at der også findes en Obserkode-række
        ok = (await session.execute(select(Obserkode).where(Obserkode.kode == obserkode))).scalar()
        if not ok:
            session.add(Obserkode(kode=obserkode))
        await session.commit()

    if request:
        session = request.session
        session["obserkode"]     = obserkode
        session["navn"]          = navn
        session["lokalafdeling"] = None
        csrf_token = generate_csrf_token(session)
    else:
        csrf_token = None

    return {"ok": True, "token": token, "navn": navn, "csrf_token": csrf_token}

@app.post("/api/set_afdeling")
async def set_afdeling_kommune(data: Dict[str, Any] = Body(...), request: Request = None):
    lokalafdeling = data.get("lokalafdeling")
    kommune = data.get("kommune")
    if not request:
        raise HTTPException(status_code=401, detail="Ikke logget ind")
    web_session = request.session
    if not web_session.get("obserkode"):
        raise HTTPException(status_code=401, detail="Ikke logget ind")
    obserkode = web_session.get("obserkode")
    async with SessionLocal() as dbsession:
        user = (await dbsession.execute(select(User).where(User.obserkode == obserkode))).scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="Bruger ikke fundet")
        user.lokalafdeling = lokalafdeling
        user.kommune = kommune
        await dbsession.commit()
    web_session["lokalafdeling"] = lokalafdeling
    web_session["kommune"] = kommune
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
#  Grupper
# ---------------------------------------------------------

# --- GRUPPEMODEL (i memory eller database, her som fil for demo) ---
GRUPPEFIL = os.path.join(SERVER_DIR, "grupper.json")

def load_grupper():
    if not os.path.exists(GRUPPEFIL):
        return []
    with open(GRUPPEFIL, "r", encoding="utf-8") as f:
        return json.load(f)

def save_grupper(grupper):
    with open(GRUPPEFIL, "w", encoding="utf-8") as f:
        json.dump(grupper, f, ensure_ascii=False, indent=2)

def find_gruppe(grupper, navn):
    for g in grupper:
        if g["navn"] == navn:
            return g
    return None

# --- ENDPOINTS ---

@app.get("/api/get_grupper")
async def get_grupper(request: Request):
    """Returnér alle grupper brugeren er medlem af."""
    session = request.session
    bruger = session.get("obserkode")
    grupper = load_grupper()
    mine = [g for g in grupper if bruger and bruger in g["obserkoder"]]
    return mine

@app.post("/api/create_gruppe")
async def create_gruppe(request: Request, data: dict = Body(...)):
    session = request.session
    bruger = session.get("obserkode")
    navn = sanitize_text(data.get("navn", "").strip())
    if not bruger or not navn:
        return JSONResponse({"ok": False, "msg": "Navn og login kræves"}, status_code=400)
    grupper = load_grupper()
    if any(g["navn"] == navn for g in grupper):
        return JSONResponse({"ok": False, "msg": "Gruppenavn findes allerede"}, status_code=400)
    grupper.append({"navn": navn, "obserkoder": [bruger]})
    save_grupper(grupper)
    return {"ok": True}

@app.post("/api/rename_gruppe")
async def rename_gruppe(request: Request, data: dict = Body(...)):
    """Omdøb gruppe (kun hvis bruger er medlem)."""
    session = request.session
    bruger = session.get("obserkode")
    gammel = sanitize_text(data.get("gammel_navn", "").strip())
    ny = sanitize_text(data.get("nyt_navn", "").strip())
    if not bruger or not gammel or not ny:
        return JSONResponse({"ok": False, "msg": "Navne og login kræves"}, status_code=400)
    grupper = load_grupper()
    if any(g["navn"] == ny for g in grupper):
        return JSONResponse({"ok": False, "msg": "Gruppenavn findes allerede"}, status_code=400)
    g = find_gruppe(grupper, gammel)
    if not g or bruger not in g["obserkoder"]:
        return JSONResponse({"ok": False, "msg": "Ingen adgang"}, status_code=403)
    g["navn"] = ny
    save_grupper(grupper)
    return {"ok": True}

@app.post("/api/delete_gruppe")
async def delete_gruppe(request: Request, data: dict = Body(...)):
    """Slet gruppe (kun hvis bruger er medlem)."""
    session = request.session
    bruger = session.get("obserkode")
    navn = data.get("navn", "").strip()
    grupper = load_grupper()
    g = find_gruppe(grupper, navn)
    if not g or bruger not in g["obserkoder"]:
        return JSONResponse({"ok": False, "msg": "Ingen adgang"}, status_code=403)
    grupper = [x for x in grupper if x["navn"] != navn]
    save_grupper(grupper)
    return {"ok": True}

@app.post("/api/add_gruppemedlem")
async def add_gruppemedlem(request: Request, data: dict = Body(...)):
    session = request.session
    bruger = session.get("obserkode")
    navn = sanitize_text(data.get("navn", "").strip())
    kode = sanitize_text(data.get("obserkode", "").strip())
    grupper = load_grupper()
    g = find_gruppe(grupper, navn)
    if not g or bruger not in g["obserkoder"]:
        return JSONResponse({"ok": False, "msg": "Ingen adgang"}, status_code=403)
    if kode and kode not in g["obserkoder"]:
        g["obserkoder"].append(kode)
        save_grupper(grupper)
    return {"ok": True}

@app.post("/api/remove_gruppemedlem")
async def remove_gruppemedlem(request: Request, data: dict = Body(...)):
    """Fjern medlem fra gruppe (kun hvis bruger er medlem)."""
    session = request.session
    bruger = session.get("obserkode")
    navn = data.get("navn", "").strip()
    kode = data.get("obserkode", "").strip()
    grupper = load_grupper()
    g = find_gruppe(grupper, navn)
    if not g or bruger not in g["obserkoder"]:
        return JSONResponse({"ok": False, "msg": "Ingen adgang"}, status_code=403)
    if kode in g["obserkoder"]:
        g["obserkoder"].remove(kode)
        save_grupper(grupper)
    return {"ok": True}

@app.post("/api/gruppe_scoreboard")
async def gruppe_scoreboard(request: Request, data: dict = Body(...)):
    """
    Returnér scoreboard for en gruppe (global eller matrikel) + matrix-data.
    Body: { "navn": "Fuglehold", "scope": "gruppe_alle" | "gruppe_matrikel", "aar": 2026 }
    """
    session = request.session
    bruger = session.get("obserkode")
    navn = data.get("navn", "").strip()
    scope = data.get("scope")
    aar = data.get("aar") or await get_global_year()
    grupper = load_grupper()
    g = find_gruppe(grupper, navn)
    if not g or bruger not in g["obserkoder"]:
        return JSONResponse({"ok": False, "msg": "Ingen adgang"}, status_code=403)
    # Find brugere i gruppen
   
    koder = g["obserkoder"]
    _, SCOREBOARD_DIR, OBSER_DIR = get_data_dirs(aar)
    rows = []
    async with SessionLocal() as session:
        users = (await session.execute(select(User).where(User.obserkode.in_(koder)))).scalars().all()
    # --- Matrix-data ---
    all_arter = set()
    hovedart_data = {}
    matrix = []
    for u in users:
        if scope == "gruppe_alle":
            L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "global.json")) or []
        elif scope == "gruppe_matrikel":
            L = _load_json(os.path.join(OBSER_DIR, u.obserkode, "matrikelarter.json")) or []
        else:
            return JSONResponse({"ok": False, "msg": "Ukendt scope"}, status_code=400)
        # Scoreboard-row
        a, art, dato = 0, "", ""
        if L:
            unique_arter = { (r.get("artnavn") or "").split("(")[0].split(",")[0].strip()
                             for r in L if r.get("artnavn") and "sp." not in r.get("artnavn") and "/" not in r.get("artnavn") and " x " not in r.get("artnavn") }
            a = len(unique_arter)
            latest = max(L, key=lambda r: _parse_ddmmyyyy(r.get("dato")), default={})
            art = latest.get("artnavn", "")
            dato = latest.get("dato", "")
        rows.append({
            "navn": u.navn or u.obserkode,
            "obserkode": u.obserkode,
            "antal_arter": a,
            "sidste_art": art,
            "sidste_dato": dato,
        })
        # Matrix-data
        for r in L:
            ha = (r.get("artnavn") or "").split("(")[0].split(",")[0].strip()
            if "sp." in ha or "/" in ha or " x " in ha:
                continue
            all_arter.add(ha)
            hovedart_data.setdefault(ha, {}).setdefault(u.obserkode, []).append(r.get("dato"))

    # Filtrér brugere med 0 arter fra
    rows = [r for r in rows if r.get("antal_arter", 0) > 0]
    koder_sorted = sorted([r["obserkode"] for r in rows])

    arter = sorted(all_arter)
    # Build matrix
    matrix = []
    for art in arter:
        row = []
        for kode in koder_sorted:
            datoer = hovedart_data.get(art, {}).get(kode, [])
            # Find tidligste dato for arten for denne kode
            if datoer:
                try:
                    d = min(datetime.datetime.strptime(d, "%d-%m-%Y") if isinstance(d, str) else d for d in datoer)
                    row.append(d.strftime("%d-%m-%Y"))
                except Exception:
                    row.append("")
            else:
                row.append("")
        matrix.append(row)
    # Totals
    totals = [sum(1 for art in arter if hovedart_data.get(art, {}).get(kode)) for kode in koder_sorted]
    # Tid og observationer (dummy, tilpas evt. til din logik)
    tid_brugt = ["00:00" for _ in koder_sorted]
    # Antal observationer pr. bruger (summen af alle observationer i L for hver bruger)
    antal_observationer = []
    for kode in koder_sorted:
        obs_count = 0
        for art in arter:
            obs_count += len(hovedart_data.get(art, {}).get(kode, []))
        antal_observationer.append(obs_count)

    # Sortér som de andre scoreboards
    rows.sort(key=lambda x: x["antal_arter"], reverse=True)
    for i, r in enumerate(rows, 1):
        r["placering"] = i

    return {
        "rows": rows,
        "arter": arter,
        "koder": koder_sorted,
        "matrix": matrix,
        "totals": totals,
        "tid_brugt": tid_brugt,
        "antal_observationer": antal_observationer
    }

# ---------------------------------------------------------
#  API: Admin
# ---------------------------------------------------------
from fastapi import Depends

async def require_admin(request: Request):
    session = request.session
    if not session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin adgang")
    return True

@app.get("/api/admin/grupper")
async def admin_get_grupper(request: Request, admin: bool = Depends(require_admin)):
    """
    Returnér alle grupper (kun navn, ikke medlemmer). Kun admin.
    """
    grupper = load_grupper()
    return [{"navn": g["navn"]} for g in grupper]

@app.post("/api/admin/slet_gruppe")
async def admin_slet_gruppe(request: Request, data: dict = Body(...), admin: bool = Depends(require_admin)):
    """
    Slet en gruppe (kun admin). Body: { "navn": "Gruppenavn" }
    """
    navn = data.get("navn", "").strip()
    grupper = load_grupper()
    grupper = [g for g in grupper if g["navn"] != navn]
    save_grupper(grupper)
    return {"ok": True, "msg": f"Gruppe '{navn}' slettet"}

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
