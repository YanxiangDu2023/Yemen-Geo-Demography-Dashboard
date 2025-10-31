# 🗺️ Yemen Geo-Demography Dashboard

This project is an interactive visualization tool that presents Yemen’s population structure and demographic changes from 2015 to 2030.  
It integrates **Leaflet.js** for spatial visualization and **Chart.js** for population analytics, providing an intuitive way to explore regional population dynamics.

In addition, the dashboard includes an **AI-based policy insight engine** that automatically summarizes key demographic patterns—such as population aging, youth expansion, or labor-age dominance—and generates concise policy suggestions to support data-driven decision-making.

---

## 🌍 Project Overview

The Yemen Geo-Demography Dashboard enables users to:
- 🗺️ **Visualize population distribution** across Yemen’s administrative divisions (ADM3 level)
- 📊 **Examine population pyramids** for selected regions and years
- 📈 **Track time-series changes** in population size and age composition from 2015 to 2030
- 💡 **Generate AI-based policy insights** summarizing demographic opportunities or challenges for each region

Each region’s visualization combines **map, chart, and text layers** to present a holistic demographic profile.

---

## 🧭 How to Initialize and Run the Project

### 1️⃣ Clone the Repository

Open your terminal and run:
```bash
git clone https://github.com/YanxiangDu2023/Yemen-Geo-Demography-Dashboard.git
cd Yemen-Geo-Demography-Dashboard
This will download the full project, including the data files (data/), main scripts, and visualization assets.

2️⃣ Start a Local Server
You can open the dashboard directly in a browser by double-clicking index.html,
but using a local server ensures charts and GeoJSON files load correctly.

Run this command in the project root:

bash
Copy code
python3 -m http.server 8080
Then visit http://localhost:8080 in your browser.
You should see an interactive map of Yemen with population data loaded.

3️⃣ Explore the Dashboard
Once it loads:

🖱️ Click on a district (ADM3) to view its population pyramid
→ The chart shows gender distribution across six age groups (pre-school, school-age, university, working-age, retirement, and 80+).

📅 Use the year selector to switch between years (2015–2030)
→ All visualizations update dynamically to show demographic trends.

💬 Read the policy insight text under the charts
→ It automatically analyzes ratios and growth rates to summarize key findings, e.g.:

“This region shows an aging trend, with elderly population (60+) projected to rise by 45% by 2030.”

🎥 Demo
![2025-10-3113 57 31-ezgif com-video-to-gif-converter](https://github.com/user-attachments/assets/47373965-75a4-4156-ad6d-f4b9353894c9)


The demo above shows how the dashboard dynamically updates as users select different regions and years.

🧱 Project Structure
Folder / File	Description
index.html	Main entry point for the dashboard UI
script.js	Core logic for data loading, map rendering, and chart updates
style.css	ESCWA-style layout and visual theme
data/yemen_adm3_population.geojson	Spatial boundary file (district-level polygons)
data/adm3_timeseries.json	Preprocessed population dataset (2015–2030 by ADM3)
data/adm3_population_timeseries.csv	Raw population data for CSV-based analysis
assets/ (optional)	Placeholder for icons or other static images

⚙️ Technical Stack
Leaflet.js — for interactive map rendering and region-level event handling

Chart.js — for age-structure and time-series visualizations

GeoJSON / CSV — for demographic and boundary datasets

Vanilla JavaScript (ES6) — for front-end logic and data binding

HTML + CSS — for layout and style (inspired by UN/ESCWA dashboard design)

🧩 Future Improvements


✨ Author
Yanxiang Du
Stockholm University
📧 yanxiangduamanda@outlook.com
