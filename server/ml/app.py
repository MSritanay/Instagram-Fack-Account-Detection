
from flask import Flask, request, jsonify
import pickle
import pandas as pd
import os
import sqlite3
import database as db

app = Flask(__name__)

# --- Database Initialization ---
db.init_db()


# --- Model Loading with Failover ---

# Define model paths
BASE_DIR = os.path.dirname(__file__)
DB_FILE = db.DB_FILE
PROFILE_MODEL_PRIMARY_PATH = os.path.join(BASE_DIR, 'random_forest_model.pkl')
PROFILE_MODEL_BACKUP_PATH = os.path.join(BASE_DIR, 'xgboost_model.pkl')
MESSAGE_MODEL_PRIMARY_PATH = os.path.join(BASE_DIR, 'multinaive_model.pkl')
MESSAGE_MODEL_BACKUP_PATH = os.path.join(BASE_DIR, 'message_logistic_regression_model.pkl')
MESSAGE_VECTORIZER_PATH = os.path.join(BASE_DIR, 'message_vectorizer.pkl')

# Initialize models to None
rf_profile_model = None
xgb_profile_model = None
mnb_message_model = None
lr_message_model = None
message_vectorizer = None

# Load profile models
print("Loading profile models...")
try:
    with open(PROFILE_MODEL_PRIMARY_PATH, 'rb') as f:
        rf_profile_model = pickle.load(f)
    print("Primary profile model (Random Forest) loaded successfully.")
except (FileNotFoundError, pickle.UnpicklingError) as e:
    print(f"Could not load primary profile model: {e}. Attempting to load backup.")
    try:
        with open(PROFILE_MODEL_BACKUP_PATH, 'rb') as f:
            xgb_profile_model = pickle.load(f)
        print("Backup profile model (XGBoost) loaded successfully.")
    except (FileNotFoundError, pickle.UnpicklingError) as e2:
        print(f"Could not load backup profile model: {e2}. Profile prediction will be unavailable.")

# Load message models
print("\nLoading message models...")
try:
    with open(MESSAGE_MODEL_PRIMARY_PATH, 'rb') as f:
        mnb_message_model = pickle.load(f)
    print("Primary message model (Multinomial NB) loaded successfully.")
except (FileNotFoundError, pickle.UnpicklingError) as e:
    print(f"Could not load primary message model: {e}. Attempting to load backup.")
    try:
        with open(MESSAGE_MODEL_BACKUP_PATH, 'rb') as f:
            lr_message_model = pickle.load(f)
        print("Backup message model (Logistic Regression) loaded successfully.")
    except (FileNotFoundError, pickle.UnpicklingError) as e2:
        print(f"Could not load backup message model: {e2}. Message prediction will be unavailable.")

# Load the message vectorizer
try:
    with open(MESSAGE_VECTORIZER_PATH, 'rb') as f:
        message_vectorizer = pickle.load(f)
    print("Message vectorizer loaded successfully.")
except (FileNotFoundError, pickle.UnpicklingError) as e:
    print(f"Could not load message vectorizer: {e}. Message prediction will be unavailable.")


@app.route('/predict_profile', methods=['POST'])
def predict_profile():
    data = request.get_json()
    # capture heuristics if sent by client
    heuristics = data.get('heuristics', {})
    df = pd.DataFrame(data, index=[0])
    
    prediction = None
    model_used = None

    # Try primary model first
    if rf_profile_model:
        try:
            prediction = rf_profile_model.predict(df)
            model_used = 'Random Forest (Primary)'
        except Exception as e:
            print(f"Error with primary profile model: {e}. Failing over to backup.")
            prediction = None # Reset prediction

    # If primary failed or wasn't loaded, try backup
    if prediction is None and xgb_profile_model:
        try:
            prediction = xgb_profile_model.predict(df)
            model_used = 'XGBoost (Backup)'
        except Exception as e:
            print(f"Error with backup profile model: {e}.")
            return jsonify({'error': 'Both profile models failed.'}), 500

    if prediction is not None:
        print(f"Prediction made using: {model_used}")
        # Store the result in the database
        username = df['username'].iloc[0] if 'username' in df.columns else 'unknown'
        prediction_label = 'Fake' if int(prediction[0]) == 1 else 'Real'
        db.store_profile_analysis(username, prediction_label, float(prediction[0]), model_used, heuristics)

        # basic anomaly detection comparing to previous risk score
        anomaly_info = None
        try:
            conn = sqlite3.connect(DB_FILE)
            c = conn.cursor()
            c.execute("SELECT risk_score FROM profile_analysis WHERE username = ? ORDER BY id DESC LIMIT 2", (username,))
            rows = c.fetchall()
            conn.close()
            if len(rows) == 2:
                prev = rows[1][0]
                delta = abs(float(prediction[0]) - prev)
                if delta > 0.2:
                    anomaly_info = {'previous_score': prev, 'current_score': float(prediction[0]), 'delta': delta}
        except Exception as e:
            print(f"Anomaly detection error: {e}")

        response = {'prediction': int(prediction[0]), 'model_used': model_used}
        if heuristics:
            response['heuristics'] = heuristics
        if anomaly_info:
            response['anomaly'] = anomaly_info
        return jsonify(response)
    else:
        return jsonify({'error': 'No profile models available for prediction.'}), 500


@app.route('/predict_messages', methods=['POST'])
def predict_messages():
    if not message_vectorizer or (not mnb_message_model and not lr_message_model):
        return jsonify({'error': 'Message model or vectorizer is not available.'}), 500

    data = request.get_json()
    messages = data.get('messages', [])
    heuristics = data.get('heuristics', {})
    if not messages:
        return jsonify({'error': 'No messages provided.'}), 400

    try:
        message_counts = message_vectorizer.transform(messages)
    except Exception as e:
        return jsonify({'error': f'Error during message vectorization: {e}'}), 500

    predictions = None
    model_used = None

    if mnb_message_model:
        try:
            predictions = mnb_message_model.predict_proba(message_counts)
            model_used = 'Multinomial NB (Primary)'
        except Exception as e:
            print(f"Error with primary message model: {e}. Failing over.")
            predictions = None
    
    if predictions is None and lr_message_model:
        try:
            predictions = lr_message_model.predict_proba(message_counts)
            model_used = 'Logistic Regression (Backup)'
        except Exception as e:
            print(f"Error with backup message model: {e}.")
            return jsonify({'error': 'Both message models failed.'}), 500

    if predictions is not None:
        # Probability of being spam is in the second column
        spam_probabilities = predictions[:, 1]
        spam_count = int(sum(p > 0.5 for p in spam_probabilities))
        overall_risk_score = float(spam_probabilities.mean()) if spam_probabilities.size > 0 else 0.0
        
        classification = "Low Risk"
        if overall_risk_score > 0.7:
            classification = "High Risk"
        elif overall_risk_score > 0.4:
            classification = "Medium Risk"

        # anomaly detection using client heuristics
        message_anomaly = None
        if heuristics and isinstance(heuristics, dict):
            burst = heuristics.get('burstScore', 0)
            spam = heuristics.get('spamScore', 0)
            if burst > 50 or spam > 70:
                message_anomaly = {'burst': burst, 'spam': spam}

        # For storage, we can log the overall analysis
        # We'll just use the first message as a content sample
        db.store_message_analysis(
            messages[0], 
            classification, 
            overall_risk_score, 
            model_used,
            heuristics
        )

        response = {
            'total_messages': len(messages),
            'spam_count': spam_count,
            'overall_risk_score': overall_risk_score,
            'classification': classification,
            'model_used': model_used
        }
        if heuristics:
            response['heuristics'] = heuristics
        if message_anomaly:
            response['anomaly'] = message_anomaly
        return jsonify(response)
    else:
        return jsonify({'error': 'No message models available for prediction.'}), 500


@app.route('/predict_final', methods=['POST'])
def predict_final():
    data = request.get_json()
    profile_features = data.get('profile_features')
    messages = data.get('messages', [])
    username = data.get('username', 'unknown')
    heuristics = data.get('heuristics', {})

    # --- Profile Risk Calculation ---
    profile_risk = 0.0
    profile_model_used = "N/A"
    if profile_features:
        df = pd.DataFrame(profile_features, index=[0])
        profile_pred_proba = None
        if rf_profile_model:
            try:
                profile_pred_proba = rf_profile_model.predict_proba(df)
                profile_model_used = 'Random Forest (Primary)'
            except Exception:
                profile_pred_proba = None
        
        if profile_pred_proba is None and xgb_profile_model:
            try:
                profile_pred_proba = xgb_profile_model.predict_proba(df)
                profile_model_used = 'XGBoost (Backup)'
            except Exception:
                profile_pred_proba = None

        if profile_pred_proba is not None:
            profile_risk = float(profile_pred_proba[0, 1]) # Probability of being 'fake'
            db.store_profile_analysis(username, 'Fake' if profile_risk > 0.5 else 'Real', profile_risk, profile_model_used, heuristics.get('profile') if isinstance(heuristics, dict) else None)

    # --- Message Risk Calculation ---
    message_risk = 0.0
    message_model_used = "N/A"
    if messages and message_vectorizer:
        message_counts = message_vectorizer.transform(messages)
        message_pred_proba = None
        if mnb_message_model:
            try:
                message_pred_proba = mnb_message_model.predict_proba(message_counts)
                message_model_used = 'Multinomial NB (Primary)'
            except Exception:
                message_pred_proba = None

        if message_pred_proba is None and lr_message_model:
            try:
                message_pred_proba = lr_message_model.predict_proba(message_counts)
                message_model_used = 'Logistic Regression (Backup)'
            except Exception:
                message_pred_proba = None
        
        if message_pred_proba is not None:
            message_risk = float(message_pred_proba[:, 1].mean()) # Average spam probability
            db.store_message_analysis(messages[0], 'High Risk' if message_risk > 0.5 else 'Low Risk', message_risk, message_model_used, heuristics.get('messages') if isinstance(heuristics, dict) else None)

    # --- Heuristic Final Risk Engine ---
    # As per Phase 8 specification.
    final_risk = 0.0
    final_classification = "Low Risk"  # Default classification

    # Rule 1: High confidence fake profile AND high risk messages
    if profile_risk > 0.75 and message_risk > 0.7:
        final_classification = "High Threat / Scam"
        # Set risk to a high value reflecting the combined threat
        final_risk = (profile_risk + message_risk) / 2

    # Rule 2: Unverified, high follower ratio, and medium risk messages
    # This requires profile_features to be present.
    elif (profile_features and
          profile_features.get('is_verified') is False and
          profile_features.get('following', 0) > 0 and
          (profile_features.get('followers', 0) / profile_features.get('following', 1)) > 100 and
          0.4 < message_risk <= 0.7):
        final_classification = "Suspicious / Bot"
        # Risk is an average of the two inputs
        final_risk = (profile_risk + message_risk) / 2

    # Default Rule: Use the higher of the two risks if no specific rule matches
    else:
        final_risk = max(profile_risk, message_risk)
        if final_risk > 0.75:
            final_classification = "High Threat / Scam"
        elif final_risk > 0.5:
            final_classification = "Suspicious / Bot"
        elif final_risk > 0.25:
            final_classification = "Potential Bot / Influencer"
        else:
            final_classification = "Low Risk"

    response = {
        'profile_risk': profile_risk,
        'message_risk': message_risk,
        'final_risk': final_risk,
        'final_classification': final_classification,
        'profile_model': profile_model_used,
        'message_model': message_model_used
    }
    if heuristics:
        response['heuristics'] = heuristics
    return jsonify(response)


# --- Dashboard Endpoints ---

@app.route('/dashboard/profiles', methods=['GET'])
def get_profiles():
    profiles = db.get_all_profile_analyses()
    return jsonify(profiles)

@app.route('/dashboard/messages', methods=['GET'])
def get_messages():
    messages = db.get_all_message_analyses()
    return jsonify(messages)


if __name__ == '__main__':
    try:
        app.run(port=5002, debug=True)
    except Exception as e:
        print(f"An error occurred: {e}")
