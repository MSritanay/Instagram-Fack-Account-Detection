
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
import joblib
import os

# --- Configuration ---
DATA_PATH = os.environ.get(
    "MESSAGE_DATASET_PATH",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "messagedatasets", "spam.csv"))
)
MODELS_DIR = os.path.dirname(__file__)

# --- Load Data ---
try:
    # The file seems to have encoding issues, try with 'latin-1'
    df = pd.read_csv(DATA_PATH, encoding='latin-1')
except FileNotFoundError:
    print(f"Error: The file was not found at {DATA_PATH}")
    exit()

# --- Preprocess Data ---
# Keep only the necessary columns and rename them for clarity
df = df[['v1', 'v2']]
df.columns = ['label', 'message']

# Convert labels to binary (0 for 'ham', 1 for 'spam')
df['label'] = df['label'].map({'ham': 0, 'spam': 1})

# Define features (X) and target (y)
X = df['message']
y = df['label']

# --- Vectorize Text Data ---
# Use TF-IDF to convert text messages into a matrix of TF-IDF features.
# This is a standard approach for text classification tasks.
print("Vectorizing text data...")
vectorizer = TfidfVectorizer(stop_words='english', max_features=5000)
X_tfidf = vectorizer.fit_transform(X)

# Save the vectorizer so we can use it for predictions on new data
vectorizer_path = os.path.join(MODELS_DIR, "message_vectorizer.pkl")
joblib.dump(vectorizer, vectorizer_path)
print(f"Vectorizer saved to {vectorizer_path}")

# --- Split Data ---
X_train, X_test, y_train, y_test = train_test_split(X_tfidf, y, test_size=0.2, random_state=42)

# --- Train and Evaluate Models ---
models = {
    "multinaive": MultinomialNB(),
    "message_logistic_regression": LogisticRegression(max_iter=1000, random_state=42)
}

for name, model in models.items():
    print(f"--- Training {name} ---")
    
    # Train the model
    model.fit(X_train, y_train)
    
    # Evaluate the model
    y_pred = model.predict(X_test)
    accuracy = accuracy_score(y_test, y_pred)
    print(f"Accuracy: {accuracy:.4f}")
    
    # Save the trained model
    model_path = os.path.join(MODELS_DIR, f"{name}_model.pkl")
    joblib.dump(model, model_path)
    print(f"Model saved to {model_path}\n")

print("--- Message analysis models trained and saved successfully! ---")
