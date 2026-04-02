import joblib
import pandas as pd
import sys
import json
import os

# Setup logging
log_file = os.path.join(os.path.dirname(__file__), 'debug.log')
with open(log_file, 'w') as f:
    f.write('Log started.\n')

def log(message):
    with open(log_file, 'a') as f:
        f.write(f'{message}\n')

def predict(data):
    log(f"Incoming data: {data}")
    primary_model_path = os.path.join(os.path.dirname(__file__), 'random_forest_model.pkl')
    backup_model_path = os.path.join(os.path.dirname(__file__), 'xgboost_model.pkl')
    model = None

    model_used = "Random Forest (Primary)"
    try:
        log("Loading primary model...")
        model = joblib.load(primary_model_path)
        log("Primary model loaded.")
    except Exception as e:
        log(f"Could not load primary model: {e}. Falling back to backup.")
        try:
            log("Loading backup model...")
            model = joblib.load(backup_model_path)
            log("Backup model loaded.")
            model_used = "XGBoost (Backup)"
        except Exception as e2:
            log(f"Could not load backup model: {e2}")
            raise RuntimeError(f"Could not load backup model: {e2}")

    # --- Feature Engineering ---
    # Create the follower_following_ratio feature
    followers = data.get('#followers', 0)
    follows = data.get('#follows', 0)
    data['follower_following_ratio'] = followers / (follows + 1)

    df = pd.DataFrame(data, index=[0])
    log(f"DataFrame columns: {df.columns.tolist()}")
    
    log("Making prediction...")
    prediction = model.predict(df)
    log(f"Prediction result: {prediction}")
    
    return {"prediction": int(prediction[0]), "model_used": model_used}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.argv[1])
        log(f"Input data from command line: {input_data}")
        result = predict(input_data)
        log(f"Final result: {result}")
        print(json.dumps(result))
    except Exception as e:
        log(f"An error occurred in __main__: {e}")
        # Also print to stderr to be safe
        print(f"Error in predict.py: {e}", file=sys.stderr)
        raise e
