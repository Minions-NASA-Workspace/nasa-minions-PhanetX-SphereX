"""Build a fixed-WCS combined unWISE W2 -> SPHEREx D6 timeline sequence with Gaia DR3 epoch overlays."""

import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
import subprocess
import sys
from tempfile import NamedTemporaryFile
import warnings

from dotenv import dotenv_values

from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
import astropy.units as u
from astropy.visualization import AsinhStretch, ImageNormalize
from astropy.wcs import WCS
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from members.dong.app.services.catalog import position_at  # noqa: E402
from scripts.export_combined_timeline_pngs import export as export_clean_player_pngs  # noqa: E402
from scripts.harvest_sky_archive import insert, sql_value  # noqa: E402
from scripts.import_sky_archive import connection_settings, run_psql  # noqa: E402
from shared.image_processing import mask_flags, reproject_compatible  # noqa: E402

MIGRATION_PATH = ROOT / "scripts" / "migrations" / "004_combined_timeline_and_gaia_overlays.sql"

TARGET_CONFIGS = {
    "wise0855": {
        "coadd_id": "1342m076",
        "title": "WISE 0855 Combined Timeline: unWISE W2 (2010-2024) -> SPHEREx DR1 D6 (2025-2026)",
        "object_name": "WISE 0855",
        "astrometry_source": "shared/targets.json (2021ApJS..253....7K; 0 reliable Gaia DR3 matches at J2016.0)",
        "require_usable": True,
    },
    "barnard": {
        "coadd_id": "2688p045",
        "title": "Barnard's Star Combined Timeline: unWISE W2 (2010-2024) -> SPHEREx DR1 D6 (2025-2026)",
        "object_name": "Barnard's Star",
        "astrometry_source": "shared/targets.json (2020yCat.1350....0G; Gaia DR3 cross-matched at J2016.0)",
        "require_usable": False,
    },
    "epsindib": {
        "coadd_id": "3323m576",
        "title": "Epsilon Indi B Combined Timeline: unWISE W2 (2010-2024) -> SPHEREx DR1 D6 (2025-2026)",
        "object_name": "Epsilon Indi B",
        "astrometry_source": "shared/targets.json (SIMBAD ICRS J2000; Gaia DR3 6412596012146801152)",
        "require_usable": True,
    },
    "rwaur": {
        "coadd_id": "0765p302",
        "title": "RW Aurigae Combined Timeline: unWISE W2 (2010-2024) -> SPHEREx DR1 D6 (2025-2026)",
        "object_name": "RW Aurigae",
        "astrometry_source": "shared/targets.json (SIMBAD ICRS J2000; Gaia DR3 cross-matched at J2016.0)",
        "require_usable": False,
    },
    "rdra": {
        "coadd_id": "2486p666",
        "title": "R Draconis Combined Timeline: unWISE W2 (2010-2024) -> SPHEREx DR1 D6 (2025-2026)",
        "object_name": "R Draconis",
        "astrometry_source": "shared/targets.json (SIMBAD ICRS J2000; Gaia DR3 cross-matched at J2016.0)",
        "require_usable": False,
    },
}


def tan_grid(ra, dec, fov_deg=0.08, scale_arcsec=2.75):
    n = int(np.ceil(fov_deg * 3600.0 / scale_arcsec))
    n += (n % 2 == 0)
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2.0, (n + 1) / 2.0]
    w.wcs.cdelt = [-scale_arcsec / 3600.0, scale_arcsec / 3600.0]
    w.wcs.radesys = "ICRS"
    return w, (n, n)


def fetch_psql_json(env, executable, sql):
    wrapped = f"SELECT json_agg(t) FROM ({sql.strip().rstrip(';')}) t;"
    out = subprocess.check_output(
        [executable, "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", wrapped],
        env=env,
        text=True,
    ).strip()
    return json.loads(out) if out else []


def mjd_to_iso(mjd):
    return Time(float(mjd), format="mjd", scale="utc").isot + "Z"


def load_unwise_frame(path):
    with fits.open(path, memmap=False) as hdus:
        hdr = hdus[0].header
        data = hdus[0].data.astype(float)
        wcs = WCS(hdr).celestial
        mjd_min = hdr.get("MJDMIN")
        mjd_max = hdr.get("MJDMAX")
        mjd_mid = 0.5 * (float(mjd_min) + float(mjd_max)) if mjd_min is not None and mjd_max is not None else float(hdr.get("MJD-OBS", 57000.0))
        epoch = int(hdr.get("EPOCH", 0))
        unw_ver = str(hdr.get("UNW_VER", "")).strip()
        release = unw_ver.split("-")[0].lower() if unw_ver.lower().startswith("neo") else "wiseview-unwise"
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "mission": "unWISE",
        "release": release,
        "band_or_detector": "W2",
        "mjd": mjd_mid,
        "mjd_min": float(mjd_min) if mjd_min is not None else mjd_mid,
        "mjd_max": float(mjd_max) if mjd_max is not None else mjd_mid,
        "wavelength_um": 4.6,
        "bandwidth_um": 1.0,
        "quality_label": f"verified_coadd_e{epoch:03d}",
        "data": data,
        "wcs": wcs,
        "sha256": sha,
        "local_source_path": path.relative_to(ROOT).as_posix(),
        "meta": {"epoch": epoch, "unw_ver": unw_ver, "bunit": str(hdr.get("BUNIT", ""))},
    }


def load_spherex_frame(path, target_ra, target_dec, *, usable=True, fallback_wave_um=4.7, fallback_bw_um=0.12):
    with fits.open(path, memmap=False) as hdus:
        img_hdu = hdus["IMAGE"] if "IMAGE" in hdus else hdus[0]
        hdr = img_hdu.header
        raw = img_hdu.data.astype(float)
        wcs = WCS(hdr, fobj=hdus).celestial
        if "FLAGS" in hdus and hdus["FLAGS"].data is not None:
            data = mask_flags(raw, hdus["FLAGS"].data, hdus["FLAGS"].header)
        else:
            data = np.where(np.isfinite(raw), raw, np.nan)
        spectral_hdr = hdr.copy()
        for k in list(spectral_hdr):
            if k.startswith(("A_", "B_", "AP_", "BP_")):
                del spectral_hdr[k]
        x, y = wcs.world_to_pixel(SkyCoord(target_ra, target_dec, unit="deg"))
        wave_um, bw_um = WCS(spectral_hdr, fobj=hdus, key="W").pixel_to_world_values(x, y)
        wave_val = float(wave_um) if np.isfinite(wave_um) and float(wave_um) > 0 else float(fallback_wave_um or 4.7)
        bw_val = float(bw_um) if np.isfinite(bw_um) and float(bw_um) > 0 else (float(fallback_bw_um) if fallback_bw_um else None)
        mjd = float(hdr.get("MJD-AVG") or hdr.get("MJD-OBS"))
        obs_id = str(hdr.get("OBSID", path.stem))
        det = int(hdr.get("DETECTOR", 6))
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    return {
        "mission": "SPHEREx",
        "release": "spherex_dr1",
        "band_or_detector": f"D{det}",
        "obs_id": obs_id,
        "mjd": mjd,
        "mjd_min": mjd,
        "mjd_max": mjd,
        "wavelength_um": wave_val,
        "bandwidth_um": bw_val,
        "quality_label": "screened_dr1_usable" if usable else "dr1_target_flagged_or_saturated",
        "data": data,
        "wcs": wcs,
        "sha256": sha,
        "local_source_path": path.relative_to(ROOT).as_posix(),
        "meta": {"obs_id": obs_id, "detector": det, "date_obs": str(hdr.get("DATE-OBS", "")), "bunit": str(hdr.get("BUNIT", "")), "usable": bool(usable)},
    }


def download_spherex_cutout(session, url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.is_file():
        return dest
    r = session.get(url, timeout=(15, 60))
    r.raise_for_status()
    tmp = dest.with_suffix(".tmp")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return dest


def render_png(reproj, norm, out_path, title, predicted_xy_png, gaia_pts):
    h, w = reproj.shape
    flipped = np.flipud(reproj)
    valid = np.isfinite(flipped)
    fig, ax = plt.subplots(figsize=(4.4, 4.4), dpi=120)
    cmap = plt.get_cmap("gray").copy()
    cmap.set_bad(color="#000000")
    ax.imshow(np.ma.masked_where(~valid, flipped), origin="upper", cmap=cmap, norm=norm, interpolation="nearest")
    # Plot Gaia reference stars (yellow circles) separately from pixel data
    for gx, gy in gaia_pts:
        ax.scatter([gx], [gy], s=42, facecolors="none", edgecolors="#facc15", linewidths=0.9, alpha=0.85)
    # Crosshair at predicted wise0855 position
    cx, cy = predicted_xy_png
    if 0 <= cx <= w - 1 and 0 <= cy <= h - 1:
        for (x0, x1), (y0, y1) in [
            ((cx - 5.5, cx - 2.0), (cy, cy)),
            ((cx + 2.0, cx + 5.5), (cy, cy)),
            ((cx, cx), (cy - 5.5, cy - 2.0)),
            ((cx, cx), (cy + 2.0, cy + 5.5)),
        ]:
            ax.plot([x0, x1], [y0, y1], color="#000000", lw=2.2)
            ax.plot([x0, x1], [y0, y1], color="#ef4444", lw=1.2)
    ax.set_title(title, fontsize=8.5, pad=6)
    ax.set_xlim(-0.5, w - 0.5)
    ax.set_ylim(h - 0.5, -0.5)
    ax.set_xticks([])
    ax.set_yticks([])
    fig.tight_layout(pad=0.35)
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def propagate_gaia_stars(gaia_rows, mjd, grid_wcs, width, height):
    if not gaia_rows:
        return []
    target_time = Time(float(mjd), format="mjd", scale="utc")
    n = len(gaia_rows)
    ra_out = np.array([float(g["ra_deg"]) for g in gaia_rows], dtype=float)
    dec_out = np.array([float(g["dec_deg"]) for g in gaia_rows], dtype=float)
    has_pm_arr = [g.get("pmra_mas_yr") is not None and g.get("pmdec_mas_yr") is not None for g in gaia_rows]

    by_epoch = {}
    for i, (g, has_pm) in enumerate(zip(gaia_rows, has_pm_arr)):
        if has_pm:
            ref_ep = float(g.get("ref_epoch_jyear") or 2016.0)
            by_epoch.setdefault(ref_ep, []).append(i)

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for ref_ep, idxs in by_epoch.items():
            c0 = SkyCoord(
                ra=ra_out[idxs] * u.deg,
                dec=dec_out[idxs] * u.deg,
                pm_ra_cosdec=np.array([float(gaia_rows[i]["pmra_mas_yr"]) for i in idxs]) * u.mas / u.yr,
                pm_dec=np.array([float(gaia_rows[i]["pmdec_mas_yr"]) for i in idxs]) * u.mas / u.yr,
                obstime=Time(ref_ep, format="jyear"),
                frame="icrs",
            )
            c_ep = c0.apply_space_motion(new_obstime=target_time)
            ra_out[idxs] = c_ep.ra.deg
            dec_out[idxs] = c_ep.dec.deg

    px_arr, py_arr = grid_wcs.world_to_pixel_values(ra_out, dec_out)
    overlays = []
    for i, g in enumerate(gaia_rows):
        x_px = float(px_arr[i])
        y_png = float((height - 1) - float(py_arr[i]))
        has_pm = has_pm_arr[i]
        in_frame = bool(0 <= x_px <= width - 1 and 0 <= y_png <= height - 1)
        overlays.append({
            "source_id": int(g["source_id"]),
            "observed_mjd": float(mjd),
            "catalog_ra_deg": float(g["ra_deg"]),
            "catalog_dec_deg": float(g["dec_deg"]),
            "propagated_ra_deg": float(ra_out[i]),
            "propagated_dec_deg": float(dec_out[i]),
            "pixel_x": x_px,
            "pixel_y_png": y_png,
            "in_frame": in_frame,
            "has_proper_motion": has_pm,
            "motion_status": "propagated_pm" if has_pm else "catalog_static_no_pm",
            "g_mag": g.get("g_mag"),
        })
    return overlays


def upload_storage_object(base, key, bucket, object_path, local_path, content_type):
    object_url = f"{base}/storage/v1/object/{quote(bucket, safe='')}/{quote(object_path, safe='/')}"
    headers = {"apikey": key, "Content-Type": content_type, "x-upsert": "true"}
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    response = requests.post(
        object_url,
        data=local_path.read_bytes(),
        headers=headers,
        timeout=(10, 45),
        allow_redirects=False,
    )
    if not 200 <= response.status_code < 300:
        raise RuntimeError(f"Storage upload failed for {object_path}: HTTP {response.status_code}")
    return f"{base}/storage/v1/object/public/{quote(bucket, safe='')}/{quote(object_path, safe='/')}"


def upload_timeline_assets(env_path, out_dir, seq_id, db_env, executable):
    cfg = {**os.environ, **{k: v for k, v in dotenv_values(env_path).items() if v is not None}}
    base = cfg.get("SUPABASE_URL", "").rstrip("/")
    key = cfg.get("SUPABASE_SECRET_KEY") or cfg.get("SUPABASE_SERVICE_ROLE_KEY")
    bucket = cfg.get("SUPABASE_STORAGE_BUCKET") or "spherex-dr1-demo"
    if not (base and key):
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY in .env")

    manifest_path = out_dir / "sequence_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    prefix = f"combined/{out_dir.name}"

    # Upload clean grayscale player PNGs (not the annotated Matplotlib diagnostic plots).
    if (out_dir / "aligned_sequence.fits").is_file() and not (out_dir / "player").is_dir():
        export_clean_player_pngs(out_dir)

    sql_lines = ["BEGIN;\n"]
    frame_urls = {}
    for fr in manifest["frames"]:
        idx = int(fr["frame_index"])
        name = Path(fr["png"]).name
        player_png = out_dir / "player" / name
        local_png = player_png if player_png.is_file() else (ROOT / fr["png"])
        obj_path = f"{prefix}/{name}"
        pub_url = upload_storage_object(base, key, bucket, obj_path, local_png, "image/png")
        frame_urls[idx] = pub_url
        fr["storage_url"] = pub_url
        sql_lines.append(
            f"UPDATE sky_archive.combined_timeline_frames SET storage_url = {sql_value(pub_url)} "
            f"WHERE sequence_id = {sql_value(seq_id)} AND frame_index = {idx};\n"
        )

    bundle_specs = [
        ("blink_gif", out_dir / "blink.gif", "image/gif"),
        ("aligned_fits", out_dir / "aligned_sequence.fits", "application/fits"),
    ]
    manifest["storage_bucket"] = bucket
    manifest["public_urls"] = {}
    for key_name, path, ctype in bundle_specs:
        obj_path = f"{prefix}/{path.name}"
        manifest["public_urls"][key_name] = upload_storage_object(base, key, bucket, obj_path, path, ctype)

    manifest_obj = f"{prefix}/{manifest_path.name}"
    manifest["public_urls"]["manifest"] = (
        f"{base}/storage/v1/object/public/{quote(bucket, safe='')}/{quote(manifest_obj, safe='/')}"
    )
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    manifest["public_urls"]["manifest"] = upload_storage_object(
        base, key, bucket, manifest_obj, manifest_path, "application/json"
    )

    assets_patch = {
        "storage_bucket": bucket,
        "storage_prefix": prefix,
        "storage_url": manifest["public_urls"]["aligned_fits"],
        "public_urls": manifest["public_urls"],
    }
    sql_lines.append(
        f"UPDATE sky_archive.combined_timeline_sequences "
        f"SET upload_status = 'uploaded', "
        f"assets = coalesce(assets, '{{}}'::jsonb) || {sql_value(assets_patch)}, "
        f"updated_at = now() "
        f"WHERE sequence_id = {sql_value(seq_id)};\n"
    )
    sql_lines.append("COMMIT;\n")

    with NamedTemporaryFile(mode="w", dir=out_dir, encoding="utf-8", newline="\n", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        tmp.writelines(sql_lines)
    try:
        run_psql(db_env, executable, ["-w", "-f", str(tmp_path)])
    finally:
        tmp_path.unlink(missing_ok=True)
    print(f"Uploaded {len(frame_urls)} frame PNGs + 3 bundle assets to bucket '{bucket}' ({prefix}/) and updated Supabase URLs.")


def select_spherex_frames(d6_rows, limit=4):
    """Pick up to `limit` SPHEREx D6 epochs spanning DR1, preferring `usable=true` frames first."""
    if len(d6_rows) <= limit:
        return d6_rows
    buckets = [
        [r for r in d6_rows if float(r["observed_mjd"]) < 60900],
        [r for r in d6_rows if 60980 <= float(r["observed_mjd"]) <= 61005],
        [r for r in d6_rows if 61015 <= float(r["observed_mjd"]) <= 61040],
        [r for r in d6_rows if float(r["observed_mjd"]) >= 61140],
    ]
    selected = []
    for idx_b, grp in enumerate(buckets):
        if not grp:
            continue
        usable_grp = [r for r in grp if r.get("usable")]
        pool = usable_grp or grp
        selected.append(pool[-1] if idx_b == len(buckets) - 1 else pool[0])
    if len(selected) < limit:
        def _row_key(r):
            return r.get("product_id") or r.get("frame_id") or r.get("obs_id")

        seen_ids = {_row_key(r) for r in selected}
        ranked = sorted(d6_rows, key=lambda r: (not bool(r.get("usable")), float(r["observed_mjd"])))
        for r in ranked:
            rk = _row_key(r)
            if rk not in seen_ids:
                selected.append(r)
                seen_ids.add(rk)
            if len(selected) >= limit:
                break
    return sorted(selected, key=lambda r: float(r["observed_mjd"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-key", choices=sorted(TARGET_CONFIGS), default="wise0855")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--psql", help="Path to psql executable")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--sql-output", type=Path)
    parser.add_argument("--include-flagged", action="store_true", help="Include downloaded DR1 frames whose target pixel has saturation/quality flags")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--upload-only", action="store_true", help="Upload existing local outputs to Supabase Storage and update DB URLs")
    args = parser.parse_args()

    target_key = args.target_key
    tcfg = TARGET_CONFIGS[target_key]
    seq_id = f"{target_key}:unwise_w2_to_spherex_d6"
    out_dir = args.output_dir or (ROOT / "data" / "processed_sequences" / f"{target_key}_unwise_spherex_d6")
    sql_output = args.sql_output or (ROOT / "data" / f"combined-timeline-{target_key}.sql")

    env, executable = connection_settings(args.env_file)
    executable = args.psql or executable

    if args.upload_only:
        upload_timeline_assets(args.env_file, out_dir, seq_id, env, executable)
        return

    # 1. Fetch Gaia DR3 stars, SPHEREx D6 frames, and unWISE W2 cutouts from Supabase
    gaia_rows = fetch_psql_json(env, executable, f"""
        SELECT DISTINCT g.source_id, g.ra_deg, g.dec_deg, g.g_mag, g.parallax_mas,
               g.pmra_mas_yr, g.pmdec_mas_yr, g.ref_epoch_jyear
        FROM sky_archive.target_gaia_dr3 t
        JOIN sky_archive.gaia_dr3 g USING (source_id)
        WHERE t.target_key = {sql_value(target_key)}
        ORDER BY g.g_mag ASC NULLS LAST, g.source_id ASC
    """)
    include_flagged = args.include_flagged or not tcfg["require_usable"]
    usable_clause = "" if include_flagged else "AND usable = true"
    d6_rows = fetch_psql_json(env, executable, f"""
        SELECT frame_id, product_id, obs_id, observed_mjd, wavelength_um, bandwidth_um,
               cutout_url, usable
        FROM sky_archive.dr1_frames
        WHERE target_key = {sql_value(target_key)}
          AND detector = 6
          AND download_status = 'downloaded'
          AND target_inside = true
          AND cutout_url IS NOT NULL
          {usable_clause}
        ORDER BY observed_mjd ASC
    """)
    if not d6_rows:
        raise RuntimeError(f"No SPHEREx D6 frames found in sky_archive.dr1_frames for {target_key}")

    unwise_rows = fetch_psql_json(env, executable, f"""
        SELECT release, coadd_id, epoch, band, mjd_start, mjd_end, access_url, sha256, metadata
        FROM sky_archive.unwise_epoch_cutouts
        WHERE coadd_id = {sql_value(tcfg['coadd_id'])} AND band = 'W2'
        ORDER BY epoch ASC
    """)
    if not unwise_rows:
        raise RuntimeError(f"No unWISE W2 epochs found for {target_key} ({tcfg['coadd_id']})")

    selected_d6 = select_spherex_frames(d6_rows, limit=4)

    session = requests.Session()
    session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1.5, status_forcelist=(429, 500, 502, 503, 504))))

    frames_raw = []
    for ur in unwise_rows:
        local_rel = ur["metadata"]["local_path"]
        p = ROOT / "data" / "unwise" / local_rel
        info = load_unwise_frame(p)
        info["source_product_id"] = f"{ur['coadd_id']}:e{int(ur['epoch']):03d}:{ur['band']}"
        frames_raw.append(info)

    cutout_cache_dir = ROOT / "data" / "spherex" / target_key / "cutouts"
    for sr in selected_d6:
        dest = cutout_cache_dir / f"{sr['obs_id']}_D6.fits"
        download_spherex_cutout(session, sr["cutout_url"], dest)
        pos = position_at(target_key, float(sr["observed_mjd"]))
        info = load_spherex_frame(
            dest,
            float(pos.ra.deg),
            float(pos.dec.deg),
            usable=bool(sr.get("usable")),
            fallback_wave_um=sr.get("wavelength_um"),
            fallback_bw_um=sr.get("bandwidth_um"),
        )
        info["source_product_id"] = sr.get("product_id") or sr.get("frame_id") or f"ivo://irsa.ipac/spherex_dr1?{sr['obs_id']}/D6"
        frames_raw.append(info)

    frames_raw.sort(key=lambda f: f["mjd"])

    # 2. Fixed WCS grid covering target 2010->2026 motion (anchored at 2018.0 midpoint)
    center_2018 = position_at(target_key, Time(2018.0, format="jyear").mjd)
    grid_wcs, (height, width) = tan_grid(float(center_2018.ra.deg), float(center_2018.dec.deg), fov_deg=0.08, scale_arcsec=2.75)

    out_dir.mkdir(parents=True, exist_ok=True)

    reprojected_cubes = []
    unwise_arrays = []
    spherex_arrays = []

    for fr in frames_raw:
        reproj, _ = reproject_compatible((fr["data"], fr["wcs"]), grid_wcs, shape_out=(height, width), order="bilinear")
        fr["reprojected"] = reproj
        fr["valid_pixel_fraction"] = float(np.mean(np.isfinite(reproj)))
        reprojected_cubes.append(reproj)
        if fr["mission"] == "unWISE":
            unwise_arrays.append(reproj)
        else:
            spherex_arrays.append(reproj)

    def make_norm(arrays):
        vals = np.concatenate([a[np.isfinite(a)] for a in arrays if np.any(np.isfinite(a))])
        vmin, vmax = np.percentile(vals, [5.0, 99.5])
        if not np.isfinite(vmin) or not np.isfinite(vmax) or vmin >= vmax:
            vmin, vmax = float(np.nanmin(vals)), float(np.nanmax(vals))
        return ImageNormalize(vmin=float(vmin), vmax=float(vmax), stretch=AsinhStretch(a=0.15))

    norm_unwise = make_norm(unwise_arrays)
    norm_spherex = make_norm(spherex_arrays)

    # Check if target has any reliable Gaia match within 5 arcsec at J2016.0
    pos_2016 = position_at(target_key, Time(2016.0, format="jyear").mjd)
    gaia_matches = []
    for g in gaia_rows:
        sep = pos_2016.separation(SkyCoord(float(g["ra_deg"]), float(g["dec_deg"]), unit="deg")).arcsec
        if sep < 5.0:
            gaia_matches.append((g["source_id"], sep))

    frame_rows = []
    overlay_rows = []
    manifest_frames = []
    pil_frames = []

    for idx, fr in enumerate(frames_raw, start=1):
        pos_ep = position_at(target_key, fr["mjd"])
        px, py = grid_wcs.world_to_pixel(pos_ep)
        cx_px, cy_png = float(px), float((height - 1) - float(py))

        gaia_overlays = propagate_gaia_stars(gaia_rows, fr["mjd"], grid_wcs, width, height)
        in_frame_pts = [(o["pixel_x"], o["pixel_y_png"]) for o in gaia_overlays if o["in_frame"]]

        png_name = f"frame_{idx:03d}_{fr['mission'].lower()}.png"
        png_path = out_dir / png_name
        iso = mjd_to_iso(fr["mjd"])
        wave_lbl = f"{fr['wavelength_um']:.2f}um" if fr["wavelength_um"] else ""
        title = f"{fr['mission']} {fr['band_or_detector']} {wave_lbl} | {iso[:10]} | {fr['quality_label']}"
        norm = norm_unwise if fr["mission"] == "unWISE" else norm_spherex
        render_png(fr["reprojected"], norm, png_path, title, (cx_px, cy_png), in_frame_pts)
        pil_frames.append(Image.open(png_path).convert("RGB"))

        rel_png = png_path.relative_to(ROOT).as_posix()
        frame_rows.append((
            seq_id, idx, fr["mission"], fr["release"], fr["source_product_id"],
            fr["band_or_detector"], fr["mjd"], iso, fr["wavelength_um"], fr["bandwidth_um"],
            fr["quality_label"], float(pos_ep.ra.deg), float(pos_ep.dec.deg),
            cx_px, cy_png, fr["valid_pixel_fraction"], rel_png, None, fr["sha256"],
            {**fr["meta"], "local_fits_path": fr["local_source_path"]},
        ))
        for o in gaia_overlays:
            overlay_rows.append((
                seq_id, idx, o["source_id"], o["observed_mjd"],
                o["catalog_ra_deg"], o["catalog_dec_deg"],
                o["propagated_ra_deg"], o["propagated_dec_deg"],
                o["pixel_x"], o["pixel_y_png"], o["in_frame"],
                o["has_proper_motion"], o["motion_status"], o["g_mag"],
            ))
        manifest_frames.append({
            "frame_index": idx,
            "mission": fr["mission"],
            "release": fr["release"],
            "source_product_id": fr["source_product_id"],
            "band_or_detector": fr["band_or_detector"],
            "observed_mjd": fr["mjd"],
            "observed_utc": iso,
            "wavelength_um": fr["wavelength_um"],
            "quality_label": fr["quality_label"],
            "predicted_ra_deg": float(pos_ep.ra.deg),
            "predicted_dec_deg": float(pos_ep.dec.deg),
            "predicted_x_px": cx_px,
            "predicted_y_png_px": cy_png,
            "gaia_stars_in_frame": len(in_frame_pts),
            "png": rel_png,
        })

    # Save blink.gif and aligned FITS cube
    gif_path = out_dir / "blink.gif"
    durations = [
        1100 if (i + 1 < len(frames_raw) and frames_raw[i]["mission"] != frames_raw[i + 1]["mission"]) else 280
        for i in range(len(pil_frames))
    ]
    pil_frames[0].save(gif_path, save_all=True, append_images=pil_frames[1:], duration=durations, loop=0)

    fits_cube_path = out_dir / "aligned_sequence.fits"
    hdu = fits.PrimaryHDU(data=np.stack(reprojected_cubes, axis=0).astype(np.float32), header=grid_wcs.to_header())
    hdu.header["OBJECT"] = tcfg["object_name"]
    hdu.header["NFRAMES"] = len(frames_raw)
    hdu.writeto(fits_cube_path, overwrite=True)

    mjd_unwise_max = max(f["mjd"] for f in frames_raw if f["mission"] == "unWISE")
    mjd_spherex_min = min(f["mjd"] for f in frames_raw if f["mission"] == "SPHEREx")
    gap_days = mjd_spherex_min - mjd_unwise_max

    grid_wcs_json = {
        **dict(grid_wcs.to_header()),
        "width": width,
        "height": height,
        "pixel_scale_arcsec": 2.75,
        "center_ra_deg": float(center_2018.ra.deg),
        "center_dec_deg": float(center_2018.dec.deg),
    }
    has_flagged_spherex = any(
        f["mission"] == "SPHEREx" and f["quality_label"] != "screened_dr1_usable"
        for f in frames_raw
    )
    sat_note = (
        " Includes SPHEREx frames flagged/saturated at the bright target core; saturated pixels are masked."
        if has_flagged_spherex
        else ""
    )
    seq_row = (
        seq_id,
        target_key,
        tcfg["title"],
        "{unWISE,SPHEREx}",
        grid_wcs_json,
        len(frames_raw),
        len(unwise_arrays),
        len(spherex_arrays),
        frames_raw[0]["mjd"],
        frames_raw[-1]["mjd"],
        gap_days,
        "angular_proper_motion_only",
        False,
        False,
        tcfg["astrometry_source"],
        {
            "local_dir": out_dir.relative_to(ROOT).as_posix(),
            "blink_gif": gif_path.relative_to(ROOT).as_posix(),
            "aligned_fits": fits_cube_path.relative_to(ROOT).as_posix(),
            "manifest": (out_dir / "sequence_manifest.json").relative_to(ROOT).as_posix(),
            "storage_url": None,
        },
        "local_only",
        (
            f"Mission gap preserved ({gap_days:.1f} days between last unWISE epoch and SPHEREx D6). "
            f"No cross-mission flux/PSF/photometric matching applied; demonstration of motion only.{sat_note}"
        ),
    )

    manifest = {
        "sequence_id": seq_id,
        "target_key": target_key,
        "grid_wcs": grid_wcs_json,
        "mission_gap_days": gap_days,
        "gaia_matches": gaia_matches,
        "gaia_propagation_model": "angular_proper_motion_only (no annual parallax or observer ephemeris)",
        "frames": manifest_frames,
    }
    (out_dir / "sequence_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    exported_clean = export_clean_player_pngs(out_dir)

    # Emit SQL and optionally apply
    mig_sql = MIGRATION_PATH.read_text(encoding="utf-8")
    seq_cols = (
        "sequence_id", "target_key", "title", "missions", "grid_wcs",
        "frame_count", "unwise_frame_count", "spherex_frame_count",
        "mjd_min", "mjd_max", "mission_gap_days", "gaia_propagation_model",
        "annual_parallax_included", "observer_ephemeris_included",
        "target_astrometry_source", "assets", "upload_status", "notes",
    )
    fr_cols = (
        "sequence_id", "frame_index", "mission", "release", "source_product_id",
        "band_or_detector", "observed_mjd", "observed_at", "wavelength_um", "bandwidth_um",
        "quality_label", "predicted_ra_deg", "predicted_dec_deg", "predicted_x_px",
        "predicted_y_png_px", "valid_pixel_fraction", "local_asset_path",
        "storage_url", "source_sha256", "metadata",
    )
    ov_cols = (
        "sequence_id", "frame_index", "source_id", "observed_mjd",
        "catalog_ra_deg", "catalog_dec_deg", "propagated_ra_deg", "propagated_dec_deg",
        "pixel_x", "pixel_y_png", "in_frame", "has_proper_motion", "motion_status", "g_mag",
    )

    sql_output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", dir=sql_output.parent, encoding="utf-8", newline="\n", delete=False) as tmp:
        tmp_path = Path(tmp.name)
        tmp.write("BEGIN;\nSET LOCAL standard_conforming_strings = on;\n" + mig_sql + "\n")
        tmp.writelines(insert("combined_timeline_sequences", seq_cols, ("sequence_id",), [seq_row]))
        tmp.writelines(insert("combined_timeline_frames", fr_cols, ("sequence_id", "frame_index"), frame_rows))
        tmp.writelines(insert("gaia_frame_overlays", ov_cols, ("sequence_id", "frame_index", "source_id"), overlay_rows))
        tmp.write("COMMIT;\n")
    tmp_path.replace(sql_output)
    print(f"[{target_key}] Combined sequence built: {len(frames_raw)} frames ({len(unwise_arrays)} unWISE + {len(spherex_arrays)} SPHEREx D6), player PNGs={exported_clean}, gap={gap_days:.1f}d, overlays={len(overlay_rows)}")
    print(f"[{target_key}] SQL: {sql_output}")

    if args.apply:
        run_psql(env, executable, ["-w", "-f", str(sql_output)])
        print(f"[{target_key}] Applied combined timeline SQL to Supabase successfully.")
        cfg = dotenv_values(args.env_file)
        if cfg.get("SUPABASE_SECRET_KEY") or cfg.get("SUPABASE_SERVICE_ROLE_KEY"):
            upload_timeline_assets(args.env_file, out_dir, seq_id, env, executable)


if __name__ == "__main__":
    main()
