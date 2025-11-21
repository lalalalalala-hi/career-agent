# AI Career Agent 🤖💼

### 📖 Overview

The **AI Career Agent** is an intelligent, full-stack application designed to automate and personalize the job search lifecycle. Unlike standard job boards or static resume builders, this application utilizes a **Large Language Model (Gemini 2.5 Flash)** acting as a persistent agent to parse data, research live job opportunities, and generate hyper-personalized application documents.

### 🚩 The Problem

Job seekers face three significant friction points today:

1. **Data Re-entry:** Manually re-typing resume data into various forms is repetitive and error-prone.

2. **Search Fatigue:** Finding relevant roles often yields generic results or outdated listings.

3. **Generic Applications:** Tailoring a cover letter and resume for every single application is time-consuming, leading candidates to send generic documents that get rejected by ATS systems.

### 💡 The Solution

The AI Career Agent solves these problems using a Multi-Role Agent Architecture:

* **The Parser:** Extracts structured data (JSON) from unstructured resume text.

* **The Researcher:** Uses Google Search Grounding to find live, active job listings with direct source URLs, filtering out generic spam.

* **The Strategist:** Compares the user's stored profile against a specific Job Description (JD) to identify skill gaps and keywords.

* **The Writer:** Generates professional cover letters and resume drafts using specific evidence from the user's "Memory Bank" (Firestore profile).

### 🏗️ Architecture

The application follows a **Serverless Agentic Architecture**.

**High-Level Data Flow**

1. **User Interface (React/Vite):** The interaction layer.

2. **Brain (Gemini API):** Logic processing, reasoning, and content generation.

3. **Tools (Google Search):** External world access for live job data.

4. **Long-Term Memory (Firebase Firestore):** Persists user profile and saved jobs across sessions.

**System Diagram**

graph TD
    User[User] -->|Interacts| Client[React Client App]
    
    subgraph "Agent Brain (Gemini)"
        Client -->|Sends Prompt + Context| LLM[Gemini 2.5 Flash]
        LLM -->|Tool Call| Search[Google Search Tool]
        Search -->|Live Results| LLM
        LLM -->|Structured Response| Client
    end
    
    subgraph "Long-Term Memory (Firebase)"
        Client -->|Read/Write Profile| Firestore[(Firestore DB)]
        Client -->|Save Jobs| Firestore
    end
    
    Client -->|Auth (Anonymous/Custom)| Auth[Firebase Auth]


### ✨ Key Features (Agent Capabilities)

This project demonstrates the following advanced agent concepts:

**1. Agent Powered by LLM (Multi-Role)**

The system uses specific system instructions to switch "personas" based on the task:

* **Resume Parsing Agent:** Converts raw text -> Strict JSON Schema.

* **Job Search Agent:** Natural Language -> Google Search Queries -> JSON.

**2. Tools (Google Search Grounding)**

The agent is equipped with the **Google Search Tool**, allowing it to escape the training data cut-off and retrieve real-time, active job postings from the web.

**3. Sessions & Long-Term Memory**

Using **Firebase Firestore**, the agent maintains state beyond the browser session. It "remembers" the user's skills, experience, and saved jobs, allowing for context-aware generation days or weeks later.

**4. Context Engineering**

The application uses advanced prompting strategies (Role Prompting, Few-Shot examples in the prompt) and strictly enforced JSON schemas to ensure the LLM outputs reliable, structured data for the application to consume.

### 🛠️ Tech Stack

* **Frontend:** React, Vite, Tailwind CSS, Lucide React

* **AI/LLM:** Google Gemini API (gemini-2.5-flash-preview)

* **Database:** Firebase Firestore

* **Authentication:** Firebase Auth (Anonymous)

* **Deployment: **Firebase Hosting

### 🚀 Setup Instructions

**Prerequisites**

* Node.js installed (v18+)

* A Google Cloud Project with **Gemini API** enabled.

* A Firebase Project created.

**1. Clone the Repository**
```
git clone [https://github.com/yourusername/ai-career-agent.git](https://github.com/yourusername/ai-career-agent.git)
cd ai-career-agent
```

**2. Install Dependencies**
```
npm install
```

**3. Configure Environment Variables**

Create a ```.env``` file in the root directory and add your keys.
Note: Do not use quotes or semicolons.
```
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

**4. Run Locally**
```
npm run dev
```

Access the app at ```http://localhost:5173```.

### ☁️ Deployment (Firebase Hosting)

**1. Build the project:**
```
npm run build
```

**2. Initialize Firebase (if not done):**
```
firebase init hosting
# Select "dist" as public directory
# Configure as single-page app: Yes
# Set up automatic builds with GitHub: No
```

**3. Deploy:**
```
firebase deploy
```

### 📄 License

This project is licensed under the MIT License.

