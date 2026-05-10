#!/usr/bin/env python3
"""
loocv_eval.py — leave-one-session-out cross-validation across the v2 dataset.

Why: a single train/val/test split picks one held-out session and reports
metrics on that. With only 6-7 sessions we've seen a ±0.10 macro-F1 swing
depending on which session lands as test. LOOCV cycles every session
through test exactly once and reports mean ± std — the honest number.

What it does (per fold):
    1. Pick one fall-containing session as the held-out test set
       (the rest of the sessions are train + val, with val_frac=0.2 of remaining)
    2. Run train_lstm.py with --force-test-session and --results-json
    3. Run train_cnn_deep.py with --force-test-session and --results-json
    4. Run ensemble_predict.py with the freshly-trained checkpoints

Aggregates: per-fold macro-F1, FALL_IMPACT F1 / recall, accuracy.
Prints a summary table at the end with mean ± std across folds.

Usage:
    python loocv_eval.py --dataset dataset_v2_high_tx
    python loocv_eval.py --dataset dataset_v2_high_tx --skip-cnn
    python loocv_eval.py --dataset dataset_v2_high_tx --sessions subj01_v2_session04 subj01_v2_session06

By default skips fall-free sessions (session10) since they're useless as test.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path


def session_has_falls(session_dir: Path, labels_file: str) -> bool:
    """A session is useful as test only if it contains FALL_IMPACT segments."""
    labels_path = session_dir / labels_file
    if not labels_path.exists():
        return False
    with open(labels_path) as f:
        L = json.load(f)
    return any(seg.get("class") in ("FALL", "FALL_IMPACT")
               for seg in L.get("segments", []))


def run(cmd: list[str], log_prefix: str = "") -> int:
    """Run a subcommand, streaming stdout. Returns exit code."""
    print(f"\n{log_prefix}$ {' '.join(cmd)}")
    proc = subprocess.run(cmd)
    return proc.returncode


def parse_results_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def fmt_pct(x: float | None) -> str:
    return f"{x:.3f}" if x is not None else "—"


def summary_table(folds: list[dict], title: str) -> None:
    """Print per-fold table + mean ± std summary."""
    if not folds:
        print(f"\n[{title}] no folds completed.\n")
        return

    # Header
    print()
    print("=" * 86)
    print(f"  {title}")
    print("=" * 86)
    print(f"  {'test_session':<28} {'macro_F1':>9} {'acc':>7} "
          f"{'FALL_IMPACT_F1':>15} {'FI_recall':>10} {'FI_prec':>9}")
    print("-" * 86)

    # Per-fold rows
    macros, accs, fi_f1s, fi_recalls, fi_precs = [], [], [], [], []
    for f in folds:
        sess = f["test_session"]
        mf1 = f["macro_f1"]
        acc = f["acc"]
        fi = f.get("fall_impact") or {}
        fi_f1 = fi.get("f1")
        fi_r = fi.get("recall")
        fi_p = fi.get("precision")
        macros.append(mf1)
        accs.append(acc)
        if fi_f1 is not None: fi_f1s.append(fi_f1)
        if fi_r is not None: fi_recalls.append(fi_r)
        if fi_p is not None: fi_precs.append(fi_p)
        print(f"  {sess:<28} {mf1:>9.3f} {acc:>7.3f} "
              f"{fmt_pct(fi_f1):>15} {fmt_pct(fi_r):>10} {fmt_pct(fi_p):>9}")
    print("-" * 86)

    def stat(values):
        if not values:
            return ("—", "—")
        n = len(values)
        mean = sum(values) / n
        if n > 1:
            var = sum((v - mean) ** 2 for v in values) / (n - 1)
            std = var ** 0.5
        else:
            std = 0.0
        return (f"{mean:.3f}", f"±{std:.3f}")

    m_mean, m_std = stat(macros)
    a_mean, a_std = stat(accs)
    fi_f1_mean, fi_f1_std = stat(fi_f1s)
    fi_r_mean, fi_r_std = stat(fi_recalls)
    fi_p_mean, fi_p_std = stat(fi_precs)
    print(f"  {'MEAN':<28} {m_mean:>9} {a_mean:>7} "
          f"{fi_f1_mean:>15} {fi_r_mean:>10} {fi_p_mean:>9}")
    print(f"  {'STD ':<28} {m_std:>9} {a_std:>7} "
          f"{fi_f1_std:>15} {fi_r_std:>10} {fi_p_std:>9}")
    print()


def extract_fold_metrics(results: dict | None) -> dict | None:
    if results is None:
        return None
    fi = results.get("per_class", {}).get("FALL_IMPACT")
    return {
        "test_session": (results.get("test_sessions") or ["?"])[0],
        "macro_f1": results.get("macro_f1"),
        "acc": results.get("acc"),
        "n_test": results.get("n_test"),
        "fall_impact": {
            "f1": fi.get("f1") if fi else None,
            "recall": fi.get("recall") if fi else None,
            "precision": fi.get("precision") if fi else None,
            "support": fi.get("support") if fi else None,
        } if fi else None,
        "raw": results,
    }


# ───────────────────────────────────────────────────────────────────
# Ensemble eval (calls ensemble_predict.py and parses its stdout —
# no JSON writer over there yet, so we capture and grep).
# ───────────────────────────────────────────────────────────────────

def run_ensemble(
    python: str,
    dataset: Path,
    labels: str,
    source: str,
    lstm_ckpt: Path,
    cnn_ckpt: Path,
    capture_log: Path,
) -> dict | None:
    """Run ensemble_predict.py, capture stdout, parse the alpha-sweep result."""
    cmd = [
        python, "ensemble_predict.py",
        "--dataset", str(dataset),
        "--labels", labels,
        "--source", source,
        "--lstm-ckpt", str(lstm_ckpt),
        "--cnn-ckpt", str(cnn_ckpt),
    ]
    print(f"\n$ {' '.join(cmd)}")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    capture_log.write_text(proc.stdout + "\n---STDERR---\n" + proc.stderr)
    if proc.returncode != 0:
        print(f"  ensemble_predict.py exited with code {proc.returncode}")
        print(proc.stderr[:500])
        return None
    # Echo so user sees progress
    print(proc.stdout[-2000:])

    # Parse the alpha-sweep table, find the best macro-F1 row.
    best = None
    in_sweep = False
    test_session = None
    for line in proc.stdout.splitlines():
        if "Test sessions" in line and ":" in line:
            # "Test sessions (1): ['subj01_v2_session04']"
            try:
                test_session = line.split(":", 1)[1].strip().strip("[]'\" ")
            except Exception:
                pass
        if "Alpha sweep" in line:
            in_sweep = True
            continue
        if in_sweep:
            parts = line.split()
            # Expected: alpha acc macro_f1 fall_recall_str
            if len(parts) >= 4 and parts[0].replace(".", "", 1).isdigit():
                try:
                    alpha = float(parts[0])
                    acc = float(parts[1])
                    mf1 = float(parts[2])
                    fr_pct = float(parts[3].rstrip("%"))
                except ValueError:
                    continue
                row = {"alpha": alpha, "acc": acc, "macro_f1": mf1,
                       "fall_recall": fr_pct / 100.0}
                if best is None or row["macro_f1"] > best["macro_f1"]:
                    best = row
    if best is None:
        return None
    return {
        "test_session": test_session,
        "macro_f1": best["macro_f1"],
        "acc": best["acc"],
        "best_alpha": best["alpha"],
        "fall_impact": {
            "f1": None,                # ensemble script doesn't print per-class F1 in sweep
            "recall": best["fall_recall"],
            "precision": None,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", type=Path, default=Path("dataset_v2_high_tx"))
    p.add_argument("--labels", type=str, default="labels_v2.json")
    p.add_argument("--source", type=str, default="ours",
                   choices=["all", "ours", "csi_har"])
    p.add_argument("--sessions", type=str, nargs="*", default=None,
                   help="Specific session names to use as test folds. "
                        "Default: every session in the dataset that contains "
                        "at least one FALL segment.")
    p.add_argument("--skip-cnn", action="store_true",
                   help="Don't run the CNN trainer; only LSTM (faster).")
    p.add_argument("--skip-ensemble", action="store_true",
                   help="Don't run the ensemble after each fold.")
    p.add_argument("--epochs-lstm", type=int, default=30)
    p.add_argument("--epochs-cnn", type=int, default=80)
    p.add_argument("--out-dir", type=Path, default=Path("loocv_results"),
                   help="Directory for per-fold checkpoints + JSON.")
    p.add_argument("--python", type=str, default=".venv/bin/python")
    args = p.parse_args()

    if not args.dataset.exists():
        print(f"ERROR: dataset {args.dataset} not found.", file=sys.stderr)
        return 2

    # Discover candidate test sessions
    if args.sessions:
        candidates = list(args.sessions)
    else:
        candidates = []
        for d in sorted(args.dataset.iterdir()):
            if not d.is_dir():
                continue
            if not d.name.startswith("subj"):
                continue
            if session_has_falls(d, args.labels):
                candidates.append(d.name)
    if not candidates:
        print(f"ERROR: no fall-containing sessions found under {args.dataset}",
              file=sys.stderr)
        return 2

    print("=" * 86)
    print(f"  LOOCV across {len(candidates)} sessions in {args.dataset}/")
    for c in candidates:
        print(f"    • {c}")
    print(f"  models: lstm{' + cnn' if not args.skip_cnn else ''}"
          f"{' + ensemble' if not args.skip_ensemble else ''}")
    print(f"  results dir: {args.out_dir}")
    print("=" * 86)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    lstm_folds: list[dict] = []
    cnn_folds: list[dict] = []
    ens_folds: list[dict] = []

    t_start = time.time()
    for fi, sess in enumerate(candidates):
        print()
        print("#" * 86)
        print(f"# Fold {fi+1}/{len(candidates)} — test session: {sess}")
        print("#" * 86)

        fold_dir = args.out_dir / sess
        fold_dir.mkdir(parents=True, exist_ok=True)
        lstm_ckpt = fold_dir / "lstm.pt"
        cnn_ckpt  = fold_dir / "cnn.pt"
        lstm_json = fold_dir / "lstm.json"
        cnn_json  = fold_dir / "cnn.json"
        ens_log   = fold_dir / "ensemble.log"

        # ── LSTM ──
        cmd = [args.python, "train_lstm.py",
               "--dataset", str(args.dataset),
               "--labels", args.labels,
               "--source", args.source,
               "--lstm-units", "128,64",
               "--dense-units", "64",
               "--dropout", "0.4",
               "--recurrent-dropout", "0.15",
               "--t-seq", "16",
               "--epochs", str(args.epochs_lstm),
               "--force-test-session", sess,
               "--results-json", str(lstm_json),
               "--ckpt", str(lstm_ckpt)]
        rc = run(cmd, log_prefix=f"[fold {fi+1} LSTM] ")
        if rc != 0:
            print(f"  ⚠ LSTM training failed (rc={rc}); skipping fold.")
            continue
        lstm_res = extract_fold_metrics(parse_results_json(lstm_json))
        if lstm_res:
            lstm_folds.append(lstm_res)

        # ── CNN ──
        cnn_res = None
        if not args.skip_cnn:
            cmd = [args.python, "train_cnn_deep.py",
                   "--dataset", str(args.dataset),
                   "--labels", args.labels,
                   "--source", args.source,
                   "--epochs", str(args.epochs_cnn),
                   "--augment",
                   "--force-test-session", sess,
                   "--results-json", str(cnn_json),
                   "--ckpt", str(cnn_ckpt)]
            rc = run(cmd, log_prefix=f"[fold {fi+1} CNN] ")
            if rc != 0:
                print(f"  ⚠ CNN training failed (rc={rc}); skipping CNN/ensemble.")
            else:
                cnn_res = extract_fold_metrics(parse_results_json(cnn_json))
                if cnn_res:
                    cnn_folds.append(cnn_res)

        # ── Ensemble ──
        if not args.skip_ensemble and not args.skip_cnn and cnn_res is not None:
            ens_res = run_ensemble(
                python=args.python,
                dataset=args.dataset,
                labels=args.labels,
                source=args.source,
                lstm_ckpt=lstm_ckpt,
                cnn_ckpt=cnn_ckpt,
                capture_log=ens_log,
            )
            if ens_res:
                ens_folds.append(ens_res)

        # Periodic running summary so user can watch progress
        elapsed = time.time() - t_start
        print(f"\n  ⏱ elapsed {elapsed/60:.1f} min — folds done: "
              f"LSTM={len(lstm_folds)}/{fi+1}"
              f"  CNN={len(cnn_folds)}/{fi+1}"
              f"  ENS={len(ens_folds)}/{fi+1}")

    # ── Final summary ──
    summary_table(lstm_folds, "LSTM — leave-one-session-out")
    if not args.skip_cnn:
        summary_table(cnn_folds, "CNN  — leave-one-session-out")
    if not args.skip_ensemble and not args.skip_cnn:
        summary_table(ens_folds, "ENSEMBLE — leave-one-session-out (best alpha per fold)")

    # Save aggregate JSON
    aggregate = {
        "dataset": str(args.dataset),
        "source": args.source,
        "candidates": candidates,
        "lstm_folds": [{**f, "raw": None} for f in lstm_folds],
        "cnn_folds":  [{**f, "raw": None} for f in cnn_folds],
        "ensemble_folds": ens_folds,
    }
    agg_path = args.out_dir / "summary.json"
    with open(agg_path, "w") as fp:
        json.dump(aggregate, fp, indent=2)
    print(f"  ✓ aggregate summary → {agg_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
