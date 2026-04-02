
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from xgboost import XGBClassifier
from sklearn.metrics import accuracy_score
import joblib
import os

# --- Configuration ---
DATA_PATH = os.environ.get(
    "PROFILE_DATASET_PATH",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "profiledatset", "train.csv"))
)
MODELS_DIR = os.path.dirname(__file__)

# Define models to train
models = {
    "random_forest": RandomForestClassifier(n_estimators=100, random_state=42),
    "xgboost": XGBClassifier(n_estimators=100, random_state=42, use_label_encoder=False, eval_metric='logloss'),
    "gradient_boosting": GradientBoostingClassifier(n_estimators=100, random_state=42),
    "logistic_regression": LogisticRegression(max_iter=1000, random_state=42)
}

# --- Load and Preprocess Data ---
try:
    df = pd.read_csv(DATA_PATH)
except FileNotFoundError:
    print(f"Error: The file was not found at {DATA_PATH}")
    exit()

# Preprocessing (ensure all feature columns are numeric)
for col in ['profile pic', 'name==username', 'description length', 'external URL', 'private']:
    df[col] = df[col].astype(int)

# --- Feature Engineering ---
# Create follower-to-following ratio to capture a common bot behavior pattern
df['follower_following_ratio'] = df['#followers'] / (df['#follows'] + 1) # Add 1 to avoid division by zero

# Define features (X) and target (y)
features = ['profile pic', 'nums/length username', 'fullname words', 'nums/length fullname', 'name==username', 'description length', 'external URL', 'private', '#posts', '#followers', '#follows', 'follower_following_ratio']
target = 'fake'

X = df[features]
y = df[target]

# --- Train and Evaluate Models ---
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

for name, model in models.items():
    print(f"--- Training {name} ---")
    
    # Train the model
    model.fit(X_train, y_train)
    
    # Evaluate the model
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Accuracy: {accuracy:.4f}")

    # --- Feature Importance ---
    if hasattr(model, 'feature_importances_'):
        print("Feature Importances:")
        importances = model.feature_importances_
        feature_importance_df = pd.DataFrame({'Feature': features, 'Importance': importances})
        feature_importance_df = feature_importance_df.sort_values(by='Importance', ascending=False)
        print(feature_importance_df)
    
    # Save the trained model
    model_path = os.path.join(MODELS_DIR, f"{name}_model.pkl")
    joblib.dump(model, model_path)
    print(f"Model saved to {model_path}\n")

print("--- All models trained and saved successfully! ---")
