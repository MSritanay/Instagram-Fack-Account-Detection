import json
import os
import sys
import joblib
import numpy as np


BASE_DIR = os.path.dirname(__file__)
PRIMARY_MODEL_PATH = os.path.join(BASE_DIR, "multinaive_model.pkl")
BACKUP_MODEL_PATH = os.path.join(BASE_DIR, "message_logistic_regression_model.pkl")
VECTORIZER_PATH = os.path.join(BASE_DIR, "message_vectorizer.pkl")
MESSAGE_THRESHOLD_BY_MODEL = {
    "Multinomial NB (Primary)": 0.30,
    "Logistic Regression (Backup)": 0.20,
}


def load_model():
    if os.path.exists(PRIMARY_MODEL_PATH):
        try:
            return joblib.load(PRIMARY_MODEL_PATH), "Multinomial NB (Primary)"
        except Exception:
            pass
    if os.path.exists(BACKUP_MODEL_PATH):
        try:
            return joblib.load(BACKUP_MODEL_PATH), "Logistic Regression (Backup)"
        except Exception:
            pass
    raise FileNotFoundError("No message model found.")


def normalize_messages(payload):
    messages = payload.get("messages")
    if isinstance(messages, list):
        cleaned = [str(msg).strip() for msg in messages if str(msg).strip()]
        if cleaned:
            return cleaned
    content = str(payload.get("content", "")).strip()
    if not content:
        return []
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    return lines if lines else [content]


def calibrate_probability_to_risk(probability: float, threshold: float) -> float:
    """
    Rescale probability so the tuned decision threshold maps to risk=0.5.
    This keeps a continuous [0,1] risk score while honoring tuned thresholds.
    """
    p = float(np.clip(probability, 0.0, 1.0))
    t = float(np.clip(threshold, 0.01, 0.99))
    if p <= t:
        # Map [0, t] -> [0, 0.5]
        return (p / t) * 0.5
    # Map (t, 1] -> (0.5, 1]
    return 0.5 + ((p - t) / (1.0 - t)) * 0.5


def main():
    if len(sys.argv) < 2:
        raise ValueError("JSON payload is required.")
    payload = json.loads(sys.argv[1])
    messages = normalize_messages(payload)
    if not messages:
        print(json.dumps({"risk_score": 0.0, "model_used": "none"}))
        return

    if not os.path.exists(VECTORIZER_PATH):
        raise FileNotFoundError("message_vectorizer.pkl not found.")
    vectorizer = joblib.load(VECTORIZER_PATH)
    model, model_used = load_model()

    message_features = vectorizer.transform(messages)
    probabilities = model.predict_proba(message_features)
    spam_probs = probabilities[:, 1] if probabilities.shape[1] > 1 else np.zeros(len(messages))
    mean_prob = float(np.mean(spam_probs)) if len(spam_probs) else 0.0
    threshold_used = MESSAGE_THRESHOLD_BY_MODEL.get(model_used, 0.5)
    risk_score = calibrate_probability_to_risk(mean_prob, threshold_used)

    print(
        json.dumps(
            {
                "risk_score": risk_score,
                "mean_probability": mean_prob,
                "threshold_used": threshold_used,
                "model_used": model_used,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error in predict_messages.py: {exc}", file=sys.stderr)
        raise
