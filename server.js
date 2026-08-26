# ============================================================
# API FOOTBALL - MATCHS DU JOUR
# ============================================================

def get_matches_today():

    api_key = os.environ.get("API_FOOTBALL_KEY")

    if not api_key:
        st.error(
            "❌ API_FOOTBALL_KEY n'est pas configurée dans Render."
        )
        return []

    url = "https://v3.football.api-sports.io/fixtures"

    headers = {
        "x-apisports-key": api_key
    }

    today = datetime.now().strftime("%Y-%m-%d")

    params = {
        "date": today
    }

    try:

        response = requests.get(
            url,
            headers=headers,
            params=params,
            timeout=20
        )

        if response.status_code != 200:

            st.error(
                f"❌ Erreur API-Football : HTTP {response.status_code}"
            )

            return []

        data = response.json()

        if data.get("errors"):
            st.error(
                f"❌ Erreur API : {data['errors']}"
            )
            return []

        return data.get("response", [])

    except requests.RequestException as e:

        st.error(
            f"❌ Impossible de contacter API-Football : {e}"
        )

        return []
