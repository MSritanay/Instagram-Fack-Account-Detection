import json
import os
from datetime import datetime

import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB

try:
    from xgboost import XGBClassifier
except Exception:
    XGBClassifier = None


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))
PROFILE_DATA_PATH = os.environ.get(
    "PROFILE_DATASET_PATH",
    os.path.join(PROJECT_ROOT, "profiledatset", "train.csv"),
)
MESSAGE_DATA_PATH = os.environ.get(
    "MESSAGE_DATASET_PATH",
    os.path.join(PROJECT_ROOT, "messagedatasets", "spam.csv"),
)
REPORTS_DIR = os.path.join(BASE_DIR, "reports")


def ensure_reports_dir() -> None:
    os.makedirs(REPORTS_DIR, exist_ok=True)


def safe_roc_auc(model, x_test, y_test):
    try:
        if hasattr(model, "predict_proba"):
            y_prob = model.predict_proba(x_test)[:, 1]
            return float(roc_auc_score(y_test, y_prob))
    except Exception:
        return None
    return None


def safe_predict_proba(model, x_test):
    try:
        if hasattr(model, "predict_proba"):
            return model.predict_proba(x_test)[:, 1]
    except Exception:
        return None
    return None


def threshold_sweep(y_true, y_prob, domain: str):
    thresholds = [round(i / 100, 2) for i in range(5, 100, 5)]
    rows = []
    for threshold in thresholds:
        y_pred = (y_prob >= threshold).astype(int)
        cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
        tn, fp, fn, tp = cm.ravel()
        rows.append({
            "threshold": threshold,
            "accuracy": float(accuracy_score(y_true, y_pred)),
            "precision": float(precision_score(y_true, y_pred, zero_division=0)),
            "recall": float(recall_score(y_true, y_pred, zero_division=0)),
            "f1": float(f1_score(y_true, y_pred, zero_division=0)),
            "tp": int(tp),
            "tn": int(tn),
            "fp": int(fp),
            "fn": int(fn),
        })

    target_recall = 0.90 if domain == "message" else 0.85
    eligible = [row for row in rows if row["recall"] >= target_recall]
    if eligible:
        best = max(eligible, key=lambda row: (row["f1"], row["precision"], row["accuracy"]))
        selection_rule = f"max_f1_with_recall>={target_recall:.2f}"
    else:
        best = max(rows, key=lambda row: (row["recall"], row["f1"], row["precision"]))
        selection_rule = f"fallback_max_recall_target_{target_recall:.2f}_not_met"
    return rows, best, selection_rule


def evaluate_model(name, model, x_train, x_test, y_train, y_test, domain: str):
    model.fit(x_train, y_train)
    y_pred = model.predict(x_test)
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()
    roc_auc = safe_roc_auc(model, x_test, y_test)
    y_prob = safe_predict_proba(model, x_test)

    metrics = {
        "model": name,
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": roc_auc,
        "tp": int(tp),
        "tn": int(tn),
        "fp": int(fp),
        "fn": int(fn),
    }

    if y_prob is not None:
        rows, best, selection_rule = threshold_sweep(y_test, y_prob, domain)
        metrics["threshold_selection_rule"] = selection_rule
        metrics["threshold_selected"] = float(best["threshold"])
        metrics["tuned_accuracy"] = float(best["accuracy"])
        metrics["tuned_precision"] = float(best["precision"])
        metrics["tuned_recall"] = float(best["recall"])
        metrics["tuned_f1"] = float(best["f1"])
        metrics["tuned_tp"] = int(best["tp"])
        metrics["tuned_tn"] = int(best["tn"])
        metrics["tuned_fp"] = int(best["fp"])
        metrics["tuned_fn"] = int(best["fn"])
        metrics["threshold_rows"] = rows

    return metrics, cm


def save_confusion_matrix_csv(model_name: str, cm, prefix: str) -> str:
    path = os.path.join(REPORTS_DIR, f"{prefix}_{model_name}_confusion_matrix.csv")
    cm_df = pd.DataFrame(cm, index=["actual_0", "actual_1"], columns=["pred_0", "pred_1"])
    cm_df.to_csv(path, index=True)
    return path


def save_threshold_report_csv(model_name: str, threshold_rows, prefix: str):
    if not threshold_rows:
        return None
    path = os.path.join(REPORTS_DIR, f"{prefix}_{model_name}_threshold_sweep.csv")
    df = pd.DataFrame(threshold_rows)
    df.to_csv(path, index=False)
    return path


def run_profile_evaluation():
    df = pd.read_csv(PROFILE_DATA_PATH)
    for col in ["profile pic", "name==username", "description length", "external URL", "private"]:
        df[col] = df[col].astype(int)
    df["follower_following_ratio"] = df["#followers"] / (df["#follows"] + 1)

    features = [
        "profile pic",
        "nums/length username",
        "fullname words",
        "nums/length fullname",
        "name==username",
        "description length",
        "external URL",
        "private",
        "#posts",
        "#followers",
        "#follows",
        "follower_following_ratio",
    ]
    target = "fake"

    x = df[features]
    y = df[target]
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.2, random_state=42, stratify=y
    )

    models = {
        "random_forest": RandomForestClassifier(n_estimators=100, random_state=42),
        "gradient_boosting": GradientBoostingClassifier(n_estimators=100, random_state=42),
        "logistic_regression": LogisticRegression(max_iter=1000, random_state=42),
    }
    if XGBClassifier is not None:
        models["xgboost"] = XGBClassifier(
            n_estimators=100, random_state=42, use_label_encoder=False, eval_metric="logloss"
        )

    results = []
    for name, model in models.items():
        metrics, cm = evaluate_model(name, model, x_train, x_test, y_train, y_test, domain="profile")
        metrics["confusion_matrix_path"] = save_confusion_matrix_csv(name, cm, "profile")
        metrics["threshold_sweep_path"] = save_threshold_report_csv(
            name, metrics.pop("threshold_rows", None), "profile"
        )
        results.append(metrics)
    return results


def run_message_evaluation():
    df = pd.read_csv(MESSAGE_DATA_PATH, encoding="latin-1")
    df = df[["v1", "v2"]]
    df.columns = ["label", "message"]
    df["label"] = df["label"].map({"ham": 0, "spam": 1})
    df = df.dropna(subset=["label", "message"])

    x = df["message"]
    y = df["label"].astype(int)

    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    x_tfidf = vectorizer.fit_transform(x)
    x_train, x_test, y_train, y_test = train_test_split(
        x_tfidf, y, test_size=0.2, random_state=42, stratify=y
    )

    models = {
        "multinaive": MultinomialNB(),
        "message_logistic_regression": LogisticRegression(max_iter=1000, random_state=42),
    }

    results = []
    for name, model in models.items():
        metrics, cm = evaluate_model(name, model, x_train, x_test, y_train, y_test, domain="message")
        metrics["confusion_matrix_path"] = save_confusion_matrix_csv(name, cm, "message")
        metrics["threshold_sweep_path"] = save_threshold_report_csv(
            name, metrics.pop("threshold_rows", None), "message"
        )
        results.append(metrics)
    return results


def persist_reports(profile_results, message_results):
    summary_rows = []
    for row in profile_results:
        summary_rows.append({"domain": "profile", **row})
    for row in message_results:
        summary_rows.append({"domain": "message", **row})

    summary_df = pd.DataFrame(summary_rows)
    summary_csv = os.path.join(REPORTS_DIR, "evaluation_summary.csv")
    summary_df.to_csv(summary_csv, index=False)

    payload = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "profile": profile_results,
        "message": message_results,
    }
    summary_json = os.path.join(REPORTS_DIR, "evaluation_summary.json")
    with open(summary_json, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return summary_csv, summary_json


def print_summary(profile_results, message_results):
    print("\n=== Profile Evaluation ===")
    for row in profile_results:
        base = (
            f"{row['model']}: "
            f"acc={row['accuracy']:.4f}, prec={row['precision']:.4f}, "
            f"rec={row['recall']:.4f}, f1={row['f1']:.4f}, "
            f"roc_auc={row['roc_auc'] if row['roc_auc'] is not None else 'n/a'}"
        )
        if row.get("threshold_selected") is not None:
            tuned = (
                f", tuned@{row['threshold_selected']:.2f} -> "
                f"prec={row['tuned_precision']:.4f}, rec={row['tuned_recall']:.4f}, f1={row['tuned_f1']:.4f}"
            )
        else:
            tuned = ""
        print(base + tuned)

    print("\n=== Message Evaluation ===")
    for row in message_results:
        base = (
            f"{row['model']}: "
            f"acc={row['accuracy']:.4f}, prec={row['precision']:.4f}, "
            f"rec={row['recall']:.4f}, f1={row['f1']:.4f}, "
            f"roc_auc={row['roc_auc'] if row['roc_auc'] is not None else 'n/a'}"
        )
        if row.get("threshold_selected") is not None:
            tuned = (
                f", tuned@{row['threshold_selected']:.2f} -> "
                f"prec={row['tuned_precision']:.4f}, rec={row['tuned_recall']:.4f}, f1={row['tuned_f1']:.4f}"
            )
        else:
            tuned = ""
        print(base + tuned)


def main():
    ensure_reports_dir()
    profile_results = run_profile_evaluation()
    message_results = run_message_evaluation()
    summary_csv, summary_json = persist_reports(profile_results, message_results)
    print_summary(profile_results, message_results)
    print(f"\nSaved summary CSV: {summary_csv}")
    print(f"Saved summary JSON: {summary_json}")


if __name__ == "__main__":
    main()
