import math
from datetime import date

import streamlit as st


# ============================================================
# CONFIGURATION
# ============================================================

st.set_page_config(
    page_title="FIFA LIVE PRO BET",
    page_icon="⚽",
    layout="centered"
)


# ============================================================
# LOI DE POISSON
# ============================================================

def poisson_probability(lmbda, goals):
    """
    Calcule la probabilité de marquer exactement
    'goals' buts avec une loi de Poisson.
    """
    return (
        math.exp(-lmbda)
        * (lmbda ** goals)
        / math.factorial(goals)
    )


# ============================================================
# CALCUL DES SCORES
# ============================================================

def calculate_scores(lambda_a, lambda_b, max_goals=10):

    scores = []

    for goals_a in range(max_goals + 1):

        for goals_b in range(max_goals + 1):

            probability_a = poisson_probability(
                lambda_a,
                goals_a
            )

            probability_b = poisson_probability(
                lambda_b,
                goals_b
            )

            probability = (
                probability_a
                * probability_b
                * 100
            )

            scores.append({
                "score_a": goals_a,
                "score_b": goals_b,
                "probability": probability
            })

    # Classement déterministe
    scores.sort(
        key=lambda x: (
            -x["probability"],
            x["score_a"],
            x["score_b"]
        )
    )

    return scores


# ============================================================
# SÉLECTION DE 2 PRONOSTICS UNIQUES
# ============================================================

def get_two_daily_predictions(
    lambda_a,
    lambda_b
):

    scores = calculate_scores(
        lambda_a,
        lambda_b
    )

    predictions = []

    for score in scores:

        # Vérifie que le score est différent
        # des pronostics déjà sélectionnés.
        already_exists = any(
            p["score_a"] == score["score_a"]
            and
            p["score_b"] == score["score_b"]
            for p in predictions
        )

        if not already_exists:

            predictions.append(score)

        if len(predictions) == 2:
            break

    return predictions


# ============================================================
# INTERFACE
# ============================================================

st.title("⚽ FIFA LIVE PRO BET")

st.subheader("🎯 2 PRONOSTICS UNIQUES PAR JOUR")


# ============================================================
# ÉQUIPES
# ============================================================

col1, col2 = st.columns(2)

with col1:

    team_a = st.text_input(
        "Équipe A",
        value="Norvege"
    )

    lambda_a = st.number_input(
        "λ Équipe A",
        min_value=0.0,
        max_value=10.0,
        value=2.35,
        step=0.01
    )


with col2:

    team_b = st.text_input(
        "Équipe B",
        value="Etats Unis"
    )

    lambda_b = st.number_input(
        "λ Équipe B",
        min_value=0.0,
        max_value=10.0,
        value=0.47,
        step=0.01
    )


# ============================================================
# DATE DU JOUR
# ============================================================

today = date.today().isoformat()

st.info(
    f"📅 Pronostics du jour : {today}"
)


# ============================================================
# BOUTON
# ============================================================

if st.button(
    "🔮 GÉNÉRER LES 2 PRONOSTICS",
    type="primary",
    use_container_width=True
):

    predictions = get_two_daily_predictions(
        lambda_a,
        lambda_b
    )

    st.session_state["daily_predictions"] = predictions
    st.session_state["prediction_date"] = today


# ============================================================
# AFFICHAGE
# ============================================================

if (
    "daily_predictions" in st.session_state
    and
    st.session_state.get("prediction_date") == today
):

    predictions = st.session_state["daily_predictions"]

    st.markdown("---")

    st.header("🔥 LES 2 PRONOSTICS DU JOUR")

    for index, prediction in enumerate(
        predictions,
        start=1
    ):

        score_a = prediction["score_a"]
        score_b = prediction["score_b"]
        probability = prediction["probability"]

        st.markdown(
            f"""
            ### 🎯 PRONOSTIC {index}

            **{team_a} {score_a} - {score_b} {team_b}**

            📊 Probabilité mathématique :
            **{probability:.2f}%**
            """
        )

        st.progress(
            min(probability / 100, 1.0)
        )

        st.markdown("---")


# ============================================================
# INFORMATIONS
# ============================================================

st.caption(
    "Les pronostics sont calculés avec une loi de Poisson "
    "et aucun tirage aléatoire n'est utilisé."
)
