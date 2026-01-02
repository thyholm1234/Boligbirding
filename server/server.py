from fastapi import FastAPI, Query, HTTPException, BackgroundTasks, Request
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import Column, String, Date, Integer, select, update
import pandas as pd
import requests
import datetime
import os
import io
import asyncio
import secrets
import hashlib
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

DATABASE_URL = "sqlite+aiosqlite:///./boligbirding.db"
engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base()

class Observation(Base):
    __tablename__ = "observations"
    id = Column(Integer, primary_key=True, index=True)
    obserkode = Column(String, index=True)
    artnavn = Column(String, index=True)
    dato = Column(Date)
    turid = Column(String, index=True)         # NYT
    turtidfra = Column(String, nullable=True)  # NYT
    turtidtil = Column(String, nullable=True)  # NYT

class Obserkode(Base):
    __tablename__ = "obserkoder"
    id = Column(Integer, primary_key=True, index=True)
    kode = Column(String, unique=True, index=True)

class GlobalFilter(Base):
    __tablename__ = "globalfilter"
    id = Column(Integer, primary_key=True, index=True)
    value = Column(String, index=True)

class GlobalYear(Base):
    __tablename__ = "globalyear"
    id = Column(Integer, primary_key=True, index=True)
    value = Column(Integer, index=True)

# --- Admin adgangskode-model ---
class AdminPassword(Base):
    __tablename__ = "adminpassword"
    id = Column(Integer, primary_key=True, index=True)
    password_hash = Column(String, nullable=False)

app = FastAPI()

# Tilføj session-middleware (kræver SECRET_KEY)
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("ADMIN_SECRET", secrets.token_hex(16)))

def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def start_periodic_sync():
    loop = asyncio.get_event_loop()
    loop.create_task(periodic_sync())

async def periodic_sync():
    while True:
        print("Starter automatisk sync_all")
        try:
            # Brug en dummy BackgroundTasks, da vi ikke har en request-context
            class DummyBG:
                def add_task(self, func, *args, **kwargs):
                    asyncio.create_task(func(*args, **kwargs))
            await sync_all(background_tasks=DummyBG())
        except Exception as e:
            print("Fejl i automatisk sync:", e)
        await asyncio.sleep(1800)  # 30 minutter

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    start_periodic_sync()

async def fetch_and_store(obserkode, aar=None):
    if aar is None:
        aar = await get_global_year()
    filter_ = await get_global_filter()
    url = (
        "https://dofbasen.dk/excel/search_result1.php"
        "?design=excel&soeg=soeg&periode=maanedaar"
        f"&aar_first={aar}&aar_second={aar}"
        "&obstype=observationer&species=alle"
        f"&obserdata={obserkode}&sortering=dato"
    )
    resp = requests.get(url)
    df = pd.read_csv(io.StringIO(resp.content.decode("latin1")), sep=";", dtype=str)
    if filter_:
        df = df[df["Turnoter"].fillna("").str.contains(filter_)]
    # Gem alle observationer med Turid og tid
    async with SessionLocal() as session:
        await session.execute(
            Observation.__table__.delete().where(
                Observation.obserkode == obserkode
            )
        )
        for _, row in df.iterrows():
            try:
                dato = datetime.datetime.strptime(row["Dato"], "%Y-%m-%d").date()
            except Exception:
                continue
            obs = Observation(
                obserkode=obserkode,
                artnavn=row["Artnavn"],
                dato=dato,
                turid=row.get("Turid"),
                turtidfra=row.get("Turtidfra"),
                turtidtil=row.get("Turtidtil")
            )
            session.add(obs)
        await session.commit()

@app.get("/obserkoder")
async def get_obserkoder():
    async with SessionLocal() as session:
        result = await session.execute(select(Obserkode))
        koder = result.scalars().all()
        return [{"kode": k.kode} for k in koder]  # <-- fjern filter

@app.post("/add_obserkode")
async def add_obserkode(
    kode: str,
    background_tasks: BackgroundTasks = None,
    request: Request = None
):
    # --- Kun admin ---
    if not request or not request.session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan tilføje obserkoder")
    async with SessionLocal() as session:
        exists = await session.execute(select(Obserkode).where(Obserkode.kode == kode))
        if exists.scalar():
            raise HTTPException(status_code=400, detail="Obserkode findes allerede")
        session.add(Obserkode(kode=kode))
        await session.commit()
    aar = await get_global_year()
    background_tasks.add_task(fetch_and_store, kode, aar)
    return {"msg": "Obserkode tilføjet og synkroniseres"}

@app.delete("/delete_obserkode")
async def delete_obserkode(kode: str, request: Request = None):
    # --- Kun admin ---
    if not request or not request.session.get("is_admin"):
        raise HTTPException(status_code=403, detail="Kun admin kan slette obserkoder")
    async with SessionLocal() as session:
        result = await session.execute(select(Obserkode).where(Obserkode.kode == kode))
        obserkode = result.scalar()
        if not obserkode:
            raise HTTPException(status_code=404, detail="Obserkode ikke fundet")
        await session.delete(obserkode)
        await session.execute(
            Observation.__table__.delete().where(Observation.obserkode == kode)
        )
        await session.commit()
    return {"msg": "Obserkode og tilhørende observationer slettet"}

@app.get("/matrix")
async def get_matrix():
    async with SessionLocal() as session:
        result = await session.execute(select(Observation))
        rows = result.scalars().all()
    all_arter = set()
    all_koder = set()
    hovedart_data = {}
    kode_ture = {}  # kode -> turid -> (fra, til)
    kode_turid_set = {}  # kode -> set af turid

    def hovedart(artnavn):
        navn = artnavn.split('(')[0].split(',')[0].strip()
        return navn

    for obs in rows:
        ha = hovedart(obs.artnavn)
        if "sp." in ha or "/" in ha or " x " in ha:
            continue
        all_arter.add(ha)
        all_koder.add(obs.obserkode)
        hovedart_data.setdefault(ha, {}).setdefault(obs.obserkode, []).append(obs.dato)
        # Saml turid og tid for hver kode
        if obs.turid and obs.turtidfra and obs.turtidtil:
            kode_ture.setdefault(obs.obserkode, {})[obs.turid] = (obs.turtidfra, obs.turtidtil)
        # Saml alle unikke turid for antal ture
        if obs.turid:
            kode_turid_set.setdefault(obs.obserkode, set()).add(obs.turid)

    matrix = []
    arter = sorted(all_arter)
    koder = sorted(all_koder)
    for art in arter:
        row = []
        for kode in koder:
            datoer = hovedart_data.get(art, {}).get(kode, [])
            if datoer:
                min_dato = min(datoer)
                row.append(min_dato.strftime("%d-%m-%Y"))
            else:
                row.append("")
        matrix.append(row)
    totals = [sum(1 for art in arter if hovedart_data.get(art, {}).get(kode)) for kode in koder]

    # Antal ture = antal unikke turid pr. kode
    antal_ture = [len(kode_turid_set.get(kode, set())) for kode in koder]

    # Tid brugt: sum af alle tures varighed for hver kode
    def tid_i_minutter(tidfra, tidtil):
        try:
            t1 = datetime.datetime.strptime(tidfra, "%H:%M")
            t2 = datetime.datetime.strptime(tidtil, "%H:%M")
            diff = (t2 - t1).total_seconds() / 60
            return max(0, int(diff))
        except Exception:
            return 0

    tid_brugt = []
    for kode in koder:
        ture = kode_ture.get(kode, {})
        total_min = sum(tid_i_minutter(fra, til) for fra, til in ture.values())
        hours = total_min // 60
        minutes = total_min % 60
        tid_brugt.append(f"{hours:02}:{minutes:02}")

    return {
        "arter": arter,
        "koder": koder,
        "matrix": matrix,
        "totals": totals,
        "tid_brugt": tid_brugt,
        "antal_observationer": antal_ture
    }

@app.post("/sync_obserkode")
async def sync_obserkode(
    kode: str,
    background_tasks: BackgroundTasks = None
):
    async with SessionLocal() as session:
        result = await session.execute(select(Obserkode).where(Obserkode.kode == kode))
        obserkode = result.scalar()
        if not obserkode:
            raise HTTPException(status_code=404, detail="Obserkode ikke fundet")
    aar = await get_global_year()
    background_tasks.add_task(fetch_and_store, kode, aar)
    return {"msg": f"Sync startet for {kode}"}

@app.post("/sync_all")
async def sync_all(background_tasks: BackgroundTasks = None):
    async with SessionLocal() as session:
        result = await session.execute(select(Obserkode))
        koder = result.scalars().all()
    aar = await get_global_year()
    for k in koder:
        background_tasks.add_task(fetch_and_store, k.kode, aar)
    return {"msg": f"Sync startet for {len(koder)} obserkoder"}

FILTER_PATH = os.path.join(os.path.dirname(__file__), "global_filter.txt")

async def get_global_filter():
    async with SessionLocal() as session:
        result = await session.execute(select(GlobalFilter).order_by(GlobalFilter.id.desc()))
        row = result.scalars().first()
        return row.value if row else ""

async def set_global_filter(value):
    async with SessionLocal() as session:
        # Slet gamle filtre (så der kun er ét)
        await session.execute(GlobalFilter.__table__.delete())
        session.add(GlobalFilter(value=value.strip()))
        await session.commit()

@app.post("/set_filter")
async def set_filter(filter: str):
    await set_global_filter(filter)
    return {"msg": "Globalt filter opdateret"}

@app.get("/get_filter")
async def get_filter():
    value = await get_global_filter()
    return {"filter": value}

async def get_global_year():
    async with SessionLocal() as session:
        result = await session.execute(select(GlobalYear).order_by(GlobalYear.id.desc()))
        row = result.scalars().first()
        if row and row.value:
            return row.value
        # Default til nuværende år hvis ikke sat
        return datetime.datetime.now().year

async def set_global_year(value):
    async with SessionLocal() as session:
        await session.execute(GlobalYear.__table__.delete())
        session.add(GlobalYear(value=int(value)))
        await session.commit()

@app.post("/set_year")
async def set_year(year: int):
    await set_global_year(year)
    return {"msg": "Globalt år opdateret"}

@app.get("/get_year")
async def get_year():
    value = await get_global_year()
    return {"year": value}

@app.post("/admin_login")
async def admin_login(request: Request, data: dict):
    password = data.get("password", "")
    async with SessionLocal() as session:
        result = await session.execute(select(AdminPassword).order_by(AdminPassword.id.desc()))
        row = result.scalars().first()
        if not row:
            # Første login: sæt adgangskode
            session.add(AdminPassword(password_hash=hash_password(password)))
            await session.commit()
            request.session["is_admin"] = True
            return {"ok": True, "first": True}
        if hash_password(password) == row.password_hash:
            request.session["is_admin"] = True
            return {"ok": True}
        return JSONResponse({"ok": False}, status_code=401)

@app.get("/is_admin")
async def is_admin(request: Request):
    return {"isAdmin": bool(request.session.get("is_admin"))}

@app.post("/admin_logout")
async def admin_logout(request: Request):
    request.session.clear()
    return {"ok": True}

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
static_dir = os.path.join(BASE_DIR, "web")
if not os.path.isdir(static_dir):
    # Fallback: prøv i samme mappe som server.py (hvis man kører alt fra /server)
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")