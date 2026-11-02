from flask import Flask, request, jsonify, render_template
import pandas as pd
import numpy as np
import joblib
import os
import traceback

try:
    from flask_cors import CORS
    HAS_CORS = True
except ImportError:
    HAS_CORS = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, static_folder="static", template_folder="templates")

if HAS_CORS:
    cors_origins = os.environ.get("CORS_ORIGINS", "*")
    CORS(app, resources={r"/*": {"origins": cors_origins}})

# -------------------------------------------------------------------
# Load saved artifacts (exactly as saved by the notebook)
# -------------------------------------------------------------------
MODEL_PATH = os.path.join(BASE_DIR, "model", "model.pkl")
SCALER_PATH = os.path.join(BASE_DIR, "model", "scaler.pkl")
OHE_PATH = os.path.join(BASE_DIR, "model", "ohe.pkl")

model = joblib.load(MODEL_PATH)
scaler = joblib.load(SCALER_PATH)
ohe = joblib.load(OHE_PATH)

# -------------------------------------------------------------------
# Frontend -> pipeline field mapping
# -------------------------------------------------------------------
# script.js sends snake_case keys (applicant_income, credit_score, ...).
# The notebook's dataframe/model use the original PascalCase CSV column
# names (Applicant_Income, Credit_Score, ...). This map bridges the two
# so the frontend does not need to be rewritten to PascalCase.
FRONTEND_TO_PIPELINE = {
    "applicant_income": "Applicant_Income",
    "coapplicant_income": "Coapplicant_Income",
    "employment_status": "Employment_Status",
    "age": "Age",
    "marital_status": "Marital_Status",
    "dependents": "Dependents",
    "credit_score": "Credit_Score",
    "existing_loans": "Existing_Loans",
    "dti_ratio": "DTI_Ratio",
    "savings": "Savings",
    "collateral_value": "Collateral_Value",
    "loan_amount": "Loan_Amount",
    "loan_term": "Loan_Term",
    "loan_purpose": "Loan_Purpose",
    "property_area": "Property_Area",
    "education": "Education_Level",
    "gender": "Gender",
    "employer_category": "Employer_Category",
}

# Fields the frontend form actually collects (script.js -> collectFormData).
REQUIRED_FRONTEND_FIELDS = [
    field for field in FRONTEND_TO_PIPELINE if field != "collateral_value"
]

# Label Encoding used in the notebook (cell 21):
# le.fit_transform(df["Education_Level"]) -> sklearn LabelEncoder sorts
# classes alphabetically. Verified against dataset/loan_approval_data.csv,
# whose only two values are "Graduate" and "Not Graduate":
# "Graduate" -> 0, "Not Graduate" -> 1
EDUCATION_LEVEL_MAP = {
    "Graduate": 0,
    "Not Graduate": 1,
}

# Columns OneHotEncoded in the notebook (cell 23), pulled from the saved
# encoder itself instead of being hardcoded.
OHE_COLUMNS = list(ohe.feature_names_in_)

# Columns dropped after feature engineering (notebook cell 41):
# DTI_Ratio_sq / Credit_Score_sq were created, then the raw Credit_Score
# and DTI_Ratio columns were dropped along with the target Loan_Approved.
COLUMNS_TO_DROP_AFTER_FE = ["Credit_Score", "DTI_Ratio"]

# Final column order the scaler/model expect, pulled directly from the
# fitted scaler instead of being hardcoded.
FINAL_FEATURE_ORDER = list(scaler.feature_names_in_)

# Numeric fields that must be coercible to float/int.
NUMERIC_FRONTEND_FIELDS = [
    "applicant_income", "coapplicant_income", "age", "dependents",
    "credit_score", "existing_loans", "dti_ratio", "savings",
    "loan_amount", "loan_term",
]

# Publicly documented home-loan credit-score rules. These are score screens,
# not loan approvals; banks assess income, repayment capacity and other factors.
# Keep only rules supported by the linked bank pages and recheck them regularly.
BANK_CREDIT_RULES = {
    "Home": [
        {
            "name": "State Bank of India (SBI)",
            "minimum_score": 550,
            "summary": "SBI's published home-loan terms state that scores below 550 are not eligible.",
            "source": "https://sbi.co.in/web/business/information/interest-rates",
            "source_label": "SBI home loan credit score rates",
        },
        {
            "name": "Punjab National Bank (PNB)",
            "minimum_score": None,
            "summary": "PNB states that no minimum CIC score is prescribed for its housing loan.",
            "source": "https://www.pnbindia.in/FAQ.html?page=FAQ.html",
            "source_label": "PNB housing loan FAQ",
        },
    ]
}


def find_credit_score_banks(credit_score: int, loan_purpose: str) -> dict:
    """Return banks whose published score screen matches this product/score."""
    rules = BANK_CREDIT_RULES.get(loan_purpose)
    if rules is None:
        return {
            "supported": False,
            "count": 0,
            "banks": [],
            "message": "We don't have verified bank credit-score rules for this loan purpose yet.",
        }

    eligible = [bank for bank in rules
                if bank["minimum_score"] is None or credit_score >= bank["minimum_score"]]
    return {
        "supported": True,
        "count": len(eligible),
        "banks": eligible,
        "message": "These banks' published credit-score criteria match your score. This is not a loan approval or complete eligibility check.",
    }


def build_pipeline_row(payload: dict) -> dict:
    """Translate the frontend's snake_case payload into the PascalCase
    column names the notebook's pipeline was built around, and apply the
    one unit conversion the UI needs: DTI Ratio is collected from the
    user as a percentage (0-100, per index.html's 'DTI Ratio (%)' field)
    but the model was trained on a 0-1 ratio (dataset range is 0.1-0.6).
    """
    row = {}
    for frontend_key, pipeline_key in FRONTEND_TO_PIPELINE.items():
        # Collateral is no longer collected by the UI. Retain the model's
        # expected feature with a neutral zero value for compatibility.
        row[pipeline_key] = payload.get(frontend_key, 0) if frontend_key == "collateral_value" else payload[frontend_key]

    # UI collects a percentage; the model expects a fraction.
    row["DTI_Ratio"] = float(row["DTI_Ratio"]) / 100.0

    return row


def preprocess(data: dict) -> pd.DataFrame:
    """
    Reproduces the EXACT final preprocessing pipeline from the notebook:
    Label Encoding (Education_Level) -> Feature Engineering
    (DTI_Ratio_sq, Credit_Score_sq) -> OneHotEncoding (saved ohe.pkl)
    -> Feature Selection (drop Credit_Score, DTI_Ratio) -> Final Column
    Order (from scaler.pkl) -> Scaling (saved scaler.pkl)
    """
    df = pd.DataFrame([data])

    # ---------------- Label Encoding ----------------
    raw_value = df.loc[0, "Education_Level"]
    if raw_value not in EDUCATION_LEVEL_MAP:
        raise ValueError(
            f"Invalid value for 'education': {raw_value!r}. "
            f"Expected one of {list(EDUCATION_LEVEL_MAP.keys())}."
        )
    df["Education_Level"] = df["Education_Level"].map(EDUCATION_LEVEL_MAP)

    # ---------------- Feature Engineering ----------------
    df["DTI_Ratio_sq"] = df["DTI_Ratio"].astype(float) ** 2
    df["Credit_Score_sq"] = df["Credit_Score"].astype(float) ** 2

    # ---------------- OneHotEncoding (using saved encoder) ----------------
    ohe_input = df[OHE_COLUMNS]
    ohe_array = ohe.transform(ohe_input)
    if hasattr(ohe_array, "toarray"):
        ohe_array = ohe_array.toarray()
    ohe_feature_names = ohe.get_feature_names_out(OHE_COLUMNS)
    ohe_df = pd.DataFrame(ohe_array, columns=ohe_feature_names, index=df.index)

    df = df.drop(columns=OHE_COLUMNS)
    df = pd.concat([df, ohe_df], axis=1)

    # ---------------- Feature Selection ----------------
    df = df.drop(columns=[c for c in COLUMNS_TO_DROP_AFTER_FE if c in df.columns])

    # ---------------- Final Column Order ----------------
    missing_after_transform = [c for c in FINAL_FEATURE_ORDER if c not in df.columns]
    if missing_after_transform:
        raise ValueError(
            f"Preprocessing did not produce required features: {missing_after_transform}"
        )
    df = df[FINAL_FEATURE_ORDER]

    return df


@app.route("/")
def index():
    return render_template("index.html")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "healthy", "model_loaded": model is not None}), 200

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json(force=True, silent=True)

        if not data:
            return jsonify({"error": "No input data provided"}), 400

        # Missing fields validation
        missing_fields = [
            f for f in REQUIRED_FRONTEND_FIELDS
            if f not in data or data[f] in (None, "")
        ]

        if missing_fields:
            return jsonify({
                "error": f"Missing required field(s): {', '.join(missing_fields)}"
            }), 400

        # Numeric validation
        bad_numeric = []
        for f in NUMERIC_FRONTEND_FIELDS:
            try:
                float(data[f])
            except (TypeError, ValueError):
                bad_numeric.append(f)

        if bad_numeric:
            return jsonify({
                "error": f"Field(s) must be numeric: {', '.join(bad_numeric)}"
            }), 400

        pipeline_row = build_pipeline_row(data)
        df = preprocess(pipeline_row)

        # ---------------- Debug ----------------
        print("\n========== RECEIVED JSON ==========")
        print(data)

        print("\n========== DATAFRAME BEFORE SCALING ==========")
        print(df)

        print("\n========== FEATURE NAMES ==========")
        print(df.columns.tolist())

        # ---------------- Scaling ----------------
        scaled_values = scaler.transform(df)

        print("\n========== SCALED DATA ==========")
        print(scaled_values)

        # ---------------- Prediction ----------------
        prediction = model.predict(scaled_values)

        print("\nPrediction:", prediction)

        confidence = None
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(scaled_values)[0]
            print("Probability:", proba)
            confidence = round(float(proba[int(prediction[0])]) * 100, 1)

        result = "Approved" if int(prediction[0]) == 1 else "Rejected"

        response = {
            "prediction": result,
            "bank_eligibility": find_credit_score_banks(
                int(float(data["credit_score"])), data["loan_purpose"]
            ),
        }

        if confidence is not None:
            response["confidence"] = confidence

        return jsonify(response)

    except Exception as e:
        print("Error occurred:", str(e))
        print(traceback.format_exc())
        return jsonify({
            "error": str(e)
        }), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "False").lower() in ["true", "1", "t"]
    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug
    )
