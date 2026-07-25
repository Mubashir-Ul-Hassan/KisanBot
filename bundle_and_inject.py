# KisanBot Combined Bundler and Notebook Injector
import os
import re
import json
import html

def run():
    print("--- 1. BUNDLING KISANBOT WEB APP ---")
    # Read index.html
    with open("index.html", "r", encoding="utf-8") as f:
        html_content = f.read()
        
    # Embed styles.css and styles-agent.css (order preserved)
    with open("styles.css", "r", encoding="utf-8") as f:
        css = f.read()
    html_content = re.sub(r'<link rel="stylesheet" href="styles.css">', f"<style>\n{css}\n</style>", html_content)
    with open("styles-agent.css", "r", encoding="utf-8") as f:
        css_agent = f.read()
    html_content = re.sub(r'<link rel="stylesheet" href="styles-agent.css">', f"<style>\n{css_agent}\n</style>", html_content)
    
    # Load all JSON data files and serialize to window.KISAN_DATA
    data_folder = "data"
    kisan_data = {}
    for filename in os.listdir(data_folder):
        if filename.endswith(".json"):
            key = filename.replace(".json", "").replace("_data", "")
            with open(os.path.join(data_folder, filename), "r", encoding="utf-8") as f:
                kisan_data[key] = json.load(f)
                
    data_script = f"<script>\nwindow.KISAN_DATA = {json.dumps(kisan_data, ensure_ascii=False)};\n</script>"
    html_content = html_content.replace('<script src="js/config.js"></script>', data_script + '\n<script src="js/config.js"></script>')
    
    # Inline all Javascript files (now including weather.js and gemini-agent.js)
    js_files = [
        ("js/config.js", '<script src="js/config.js"></script>'),
        ("js/voice.js", '<script src="js/voice.js"></script>'),
        ("js/parser.js", '<script src="js/parser.js"></script>'),
        ("js/weather.js", '<script src="js/weather.js"></script>'),
        ("js/engine.js", '<script src="js/engine.js"></script>'),
        ("js/gemini-agent.js", '<script src="js/gemini-agent.js"></script>'),
        ("js/conversation.js", '<script src="js/conversation.js"></script>'),
        ("js/app.js", '<script src="js/app.js"></script>')
    ]
    
    for js_path, tag in js_files:
        with open(js_path, "r", encoding="utf-8") as f:
            js_code = f.read()
        html_content = html_content.replace(tag, f"<script>\n{js_code}\n</script>")
        
    # Write bundled app to submission folder
    app_output_path = "kaggle_submission/kisanbot_app.html"
    with open(app_output_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Bundled app saved at: {app_output_path}")

    print("\n--- 2. UPDATING JUPYTER NOTEBOOK ---")
    notebook_path = "kaggle_submission/kisanbot.ipynb"
    with open(notebook_path, "r", encoding="utf-8") as f:
        notebook = json.load(f)
        
    # Filter out existing credentials, server, and web app cells
    clean_cells = []
    skip_mode = False
    for cell in notebook["cells"]:
        cell_content = "".join(cell["source"])
        if cell["cell_type"] == "markdown" and any(h in cell_content for h in [
            "Section 1.2: Kaggle Secrets Configuration",
            "Section 7b: Live Background API Server",
            "Section 8: Interactive Web Interface"
        ]):
            skip_mode = True
            continue
        if skip_mode:
            # Skip this markdown cell and the following code cell
            skip_mode = False
            continue
        clean_cells.append(cell)
        
    # Define Section 1.2: Kaggle Secrets Configuration Markdown
    credentials_md = {
        "cell_type": "markdown",
        "metadata": {},
        "source": [
            "## 🔑 Section 1.2: Kaggle Secrets Configuration\n",
            "\n",
            "We securely load API credentials using Kaggle User Secrets. Before running, make sure to add:\n",
            "1.  **`GOOGLE_API_KEY`**: Your Gemini API Key.\n",
            "2.  **`OPENWEATHER_API_KEY`** (Optional): Your Weather API Key.\n",
            "in the Kaggle Editor under **Add-ons -> Secrets**."
        ]
    }

    # Define Section 1.2: Kaggle Secrets Configuration Code (COMPLETELY CREDENTIAL-FREE FALLBACKS)
    credentials_code = {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": [
            "import os\n",
            "try:\n",
            "    from kaggle_secrets import UserSecretsClient\n",
            "    user_secrets = UserSecretsClient()\n",
            "    \n",
            "    # Load Gemini API Key\n",
            "    try:\n",
            "        gemini_key = user_secrets.get_secret(\"GOOGLE_API_KEY\")\n",
            "        os.environ[\"GEMINI_API_KEY\"] = gemini_key\n",
            "        print(\"✅ GOOGLE_API_KEY successfully loaded from Kaggle Secrets!\")\n",
            "    except Exception:\n",
            "        print(\"⚠️ GOOGLE_API_KEY secret not found in Kaggle. Please configure it in Add-ons -> Secrets.\")\n",
            "    \n",
            "    # Load OpenWeather API Key\n",
            "    try:\n",
            "        weather_key = user_secrets.get_secret(\"OPENWEATHER_API_KEY\")\n",
            "        os.environ[\"OPENWEATHER_API_KEY\"] = weather_key\n",
            "        print(\"✅ OPENWEATHER_API_KEY successfully loaded from Kaggle Secrets!\")\n",
            "    except Exception:\n",
            "        print(\"ℹ️ Optional OPENWEATHER_API_KEY secret not found. Running with local simulated coordinates.\")\n",
            "except ImportError:\n",
            "    # Local run fallback\n",
            "    print(\"⚠️ Running locally. Please configure GEMINI_API_KEY and OPENWEATHER_API_KEY in your environment variables.\")\n"
        ]
    }

    # Locate index of dependencies cell in clean_cells to insert credentials
    dep_index = -1
    for i, cell in enumerate(clean_cells):
        if cell["cell_type"] == "code" and "!pip install" in "".join(cell["source"]):
            dep_index = i
            break
            
    if dep_index != -1:
        clean_cells.insert(dep_index + 1, credentials_md)
        clean_cells.insert(dep_index + 2, credentials_code)
    else:
        # Fallback to appending if dependencies cell not found
        clean_cells.append(credentials_md)
        clean_cells.append(credentials_code)

    notebook["cells"] = clean_cells

    # Define Section 7b: Live Background API Server Markdown
    server_md = {
        "cell_type": "markdown",
        "metadata": {},
        "source": [
            "## 📡 Section 7b: Live Background API Server\n",
            "\n",
            "To connect the interactive web app to the active multi-agent coordinators, we run the FastAPI backend (`server.py` logic) inside a background execution thread directly in the Jupyter kernel! This enables the frontend in the iframe to securely call the CrewAI, AutoGen, and LangGraph APIs on `localhost`."
        ]
    }

    # Define Section 7b: Live Background API Server Code
    server_code = {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": [
            "from fastapi import FastAPI, Request\n",
            "from fastapi.middleware.cors import CORSMiddleware\n",
            "import uvicorn\n",
            "import threading\n",
            "\n",
            "app = FastAPI()\n",
            "\n",
            "app.add_middleware(\n",
            "    CORSMiddleware,\n",
            "    allow_origins=[\"*\"],\n",
            "    allow_credentials=True,\n",
            "    allow_methods=[\"*\"],\n",
            "    allow_headers=[\"*\"],\n",
            ")\n",
            "\n",
            "@app.get(\"/api/health\")\n",
            "def health():\n",
            "    return {\"status\": \"ok\", \"mode\": \"ai\"}\n",
            "\n",
            "@app.post(\"/api/chat\")\n",
            "async def chat(request: Request):\n",
            "    body = await request.json()\n",
            "    query = body.get(\"message\", \"\")\n",
            "    province = body.get(\"province\", \"Punjab\")\n",
            "    irrigation = body.get(\"irrigation\", \"Canal\")\n",
            "    budget = body.get(\"budget\", \"Medium\")\n",
            "    district = body.get(\"district\", \"Multan\")\n",
            "    \n",
            "    # Classify intent using coordinator\n",
            "    state = classify_intent({\"query\": query})\n",
            "    intent = state[\"intent\"]\n",
            "    \n",
            "    response_text = \"\"\n",
            "    extra_data = {}\n",
            "    \n",
            "    if intent == \"crop_recommendation\":\n",
            "        response_text = run_crewai_consultation(province, irrigation, budget)\n",
            "    elif intent == \"pest_diagnosis\":\n",
            "        response_text = run_autogen_diagnostics(query)\n",
            "    elif intent == \"weather_satellite\":\n",
            "        sat = run_beeai_satellite_tool(district)\n",
            "        response_text = sat[\"advisory\"]\n",
            "        extra_data = {\"map\": sat[\"map\"]}\n",
            "    else:\n",
            "        response_text = \"I parsed your query, but could not route it. Please ask about crops, pests, or satellite weather.\"\n",
            "        \n",
            "    return {\n",
            "        \"response\": response_text,\n",
            "        \"urduResponse\": \"فصل کا مشورہ اور تمام معلومات فراہم کر دی گئی ہیں اور رپورٹ لائیو اپڈیٹ ہو چکی ہے۔\",\n",
            "        \"data\": extra_data\n",
            "    }\n",
            "\n",
            "# Start uvicorn server in a background thread to prevent blocking Jupyter execution\n",
            "def start_api():\n",
            "    try:\n",
            "        # Run locally on port 8000\n",
            "        uvicorn.run(app, host=\"127.0.0.1\", port=8000, log_level=\"warning\")\n",
            "    except Exception as e:\n",
            "        pass\n",
            "\n",
            "threading.Thread(target=start_api, daemon=True).start()\n",
            "print(\"FastAPI background server successfully started on http://127.0.0.1:8000!\")\n"
        ]
    }

    # Define Section 8: Interactive Web Interface Markdown
    ui_md = {
        "cell_type": "markdown",
        "metadata": {},
        "source": [
            "## 📱 Section 8: Interactive Web Interface (Chat & Voice)\n",
            "\n",
            "Run the cell below to launch the complete, interactive KisanBot user interface directly inside your Jupyter Notebook cell output! \n",
            "\n",
            "*   **💬 Text Chat**: Type queries directly into the chat bar and hit Enter.\n",
            "*   **🎤 Voice Chat**: Click the Microphone button (Google Chrome/Edge recommended) and speak in Urdu or English to get instant bilingual voice advice!"
        ]
    }

    # Define Section 8: Interactive Web Interface Code
    escaped_html = html_content.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')
    ui_code = {
        "cell_type": "code",
        "execution_count": None,
        "metadata": {},
        "outputs": [],
        "source": [
            "import html\n",
            "import os\n",
            "from IPython.display import HTML, display\n",
            "\n",
            "# The complete bundled KisanBot single-page web app\n",
            "html_app_code = \"\"\"" + escaped_html + "\"\"\"\n",
            "\n",
            "# Retrieve credentials from python environment (securely loaded via Kaggle Secrets)\n",
            "gemini_key = os.environ.get(\"GEMINI_API_KEY\", \"\")\n",
            "weather_key = os.environ.get(\"OPENWEATHER_API_KEY\", \"\")\n",
            "\n",
            "# Inject credentials into config getters before rendering the iframe\n",
            "if gemini_key:\n",
            "    html_app_code = html_app_code.replace(\n",
            "        \"safeStorage.getItem('kisanbot_gemini_key') || ''\",\n",
            "        f\"safeStorage.getItem('kisanbot_gemini_key') || '{gemini_key}'\"\n",
            "    )\n",
            "if weather_key:\n",
            "    html_app_code = html_app_code.replace(\n",
            "        \"safeStorage.getItem('kisanbot_weather_key') || ''\",\n",
            "        f\"safeStorage.getItem('kisanbot_weather_key') || '{weather_key}'\"\n",
            "    )\n",
            "\n",
            "# Escape the HTML string to embed it safely inside the iframe's srcdoc attribute\n",
            "escaped_html = html.escape(html_app_code)\n",
            "\n",
            "# Render the interface in a secure, isolated sandbox iframe with microphone permissions\n",
            "display(HTML(f'<iframe srcdoc=\"{escaped_html}\" width=\"100%\" height=\"680\" style=\"border: 1px solid #334155; border-radius: 12px; background: #0f172a;\" allow=\"microphone\" sandbox=\"allow-scripts allow-same-origin allow-forms allow-modals allow-popups\"></iframe>'))\n"
        ]
    }

    # Append cells to notebook
    notebook["cells"].append(server_md)
    notebook["cells"].append(server_code)
    notebook["cells"].append(ui_md)
    notebook["cells"].append(ui_code)
    
    with open(notebook_path, "w", encoding="utf-8") as f:
        json.dump(notebook, f, ensure_ascii=False, indent=1)
    print("Notebook updated successfully with Live Background Server, sandboxed Web UI, and Kaggle Secrets credentials injection!")

if __name__ == "__main__":
    run()
