import pandas as pd

df = pd.read_csv("data/player_seasons.csv")

# 1. Find one player (exact name match)
yamal = df[df["player"] == "Lamine Yamal"]
print(yamal[["player", "team", "season_label", "pos", "age", "fb_gls", "fb_ast", "us_xg"]])

# 2. Search by part of a name (this is what your search bar will do)
salah = df[df["player"].str.contains("Salah", case=False)]
print(salah[["player", "team", "season_label"]])

# 3. Top 5 scorers, only players with at least 10 full matches played
regulars = df[df["nineties"] >= 10]
top5 = regulars.sort_values("fb_gls", ascending=False).head(5)
print(top5[["player", "team", "season_label", "fb_gls"]])

# 4. How many values are missing in some columns?
print(df[["us_xg", "ss_keyPasses", "fifa_value_eur"]].isna().sum())