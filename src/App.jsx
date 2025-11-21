import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, collection, query, onSnapshot, addDoc, deleteDoc
} from 'firebase/firestore';
import {
  FileText, Briefcase, User, Loader2, Plus, Minus, Trash2, Save, X, Search, FileBarChart, Zap, Upload, Clipboard, Code, ChevronDown, ChevronUp
} from 'lucide-react';

// --- GLOBAL FIREBASE/ENV VARIABLES (Provided by Canvas Environment) ---
// const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
// const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
// const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : '';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent`;

// --- GLOBAL FIREBASE/ENV VARIABLES (Local Setup) ---
const appId = 'my-local-app'; 

// Get these details from your Firebase Console (Project Settings)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Leave empty for local dev, the app will fall back to Anonymous Auth
const initialAuthToken = '';

// --- FIRESTORE UTILITIES ---
const getUserCollectionPath = (userId, collectionName) => 
  `artifacts/${appId}/users/${userId}/${collectionName}`;

// --- JSON SCHEMAS (CRITICAL FOR AGENT FUNCTIONALITY) ---

const JOB_SEARCH_SCHEMA = {
    type: "ARRAY",
    items: {
        type: "OBJECT",
        properties: {
            "jobTitle": { "type": "STRING" },
            "companyName": { "type": "STRING" },
            "jobDescription": { "type": "STRING", "description": "A detailed, concise summary of the job description including requirements, duties, and qualifications. Must be a single string of text." },
            "sourceUri": { "type": "STRING", "description": "The URL link to the original job posting." }
        },
        required: ["jobTitle", "companyName", "jobDescription", "sourceUri"]
    }
};

const PROFILE_REFINE_SCHEMA = {
    type: "OBJECT",
    properties: {
        "summarySuggestion": { "type": "STRING", "description": "A 2-3 sentence suggestion for modifying the current professional summary to better target the job." },
        "keySkillsToHighlight": { 
            "type": "ARRAY", 
            "items": { "type": "STRING" },
            "description": "A list of 5-8 specific skills/keywords from the JD that the user should ensure are present and prominent in their profile." 
        },
        "missingKeywords": { 
            "type": "ARRAY", 
            "items": { "type": "STRING" },
            "description": "A list of 3-5 technical or domain terms present in the JD that are completely missing from the user's current skills/summary/experience."
        }
    },
    required: ["summarySuggestion", "keySkillsToHighlight", "missingKeywords"]
};

const RESUME_PARSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        "name": { "type": "STRING" },
        "email": { "type": "STRING" },
        "phone": { "type": "STRING" },
        "linkedIn": { "type": "STRING" },
        "summary": { "type": "STRING" },
        "skills": { 
            "type": "ARRAY", 
            "items": { "type": "STRING" },
            "description": "List of key technical and soft skills."
        },
        "experience": { 
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": { // FIX: Was missing closing quote and colon
                    "title": { "type": "STRING" },
                    "company": { "type": "STRING" },
                    "startDate": { "type": "STRING", "description": "Start date, preferably year-month format (YYYY-MM)." },
                    "endDate": { "type": "STRING", "description": "End date, 'Present' or year-month format (YYYY-MM)." },
                    "description": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "List of 3-5 key achievements/responsibilities." }
                }
            }
        },
        "projects": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "projectName": { "type": "STRING" },
                    "monthAndYear": { "type": "STRING" },
                    "projectDescription": { "type": "STRING" }
                }
            }
        },
        "education": { 
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "institution": { "type": "STRING" },
                    "degree": { "type": "STRING" },
                    "graduationYear": { "type": "STRING" }
                }
            }
        },
    },
    required: ["name", "email", "summary", "skills", "experience"]
};

// --- DEFAULT STATE TEMPLATES ---
const initialProfileState = {
  name: '',
  email: '',
  phone: '',
  linkedIn: '',
  summary: '',
  skills: [''], 
  experience: [],
  projects: [], // New state for projects
  education: [],
};

const newExperienceEntry = {
    title: '',
    company: '',
    startDate: '',
    endDate: 'Present',
    isPresent: true, 
    description: [''], 
};

const newProjectEntry = {
    projectName: '',
    monthAndYear: '',
    projectDescription: '',
};

const newEducationEntry = {
    institution: '',
    degree: '',
    graduationYear: new Date().getFullYear().toString(),
};

const initialNewJobState = {
  jobTitle: '',
  companyName: '',
  jobDescription: '',
};

// --- UTILITY COMPONENTS (Defined outside App scope to prevent ReferenceError) ---

/**
 * Main application header component.
 */
const Header = () => (
  <header className="py-4 border-b border-indigo-200 bg-white shadow-sm">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
      <h1 className="text-2xl font-extrabold text-indigo-700 tracking-tight">
        AI Career Agent
      </h1>
      <p className="text-sm text-gray-500 hidden sm:block">
        Capstone Project: Personalized Job Document Generation
      </p>
    </div>
  </header>
);

/**
 * Alert box for feedback messages.
 */
const FeedbackAlert = ({ message, type }) => {
  if (!message) return null;
  const baseClasses = "p-3 rounded-lg font-medium mb-4";
  const typeClasses = type === 'success' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-red-100 text-red-700 border border-red-300';
  return <div className={`${baseClasses} ${typeClasses}`}>{message}</div>;
};

/**
 * Standard input field component.
 */
const Field = ({ label, name, type = 'text', value, onChange, placeholder, isTextArea = false, checked, className = "" }) => (
    <div className={`mb-4 ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {isTextArea ? (
        <textarea
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={3}
          className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
        />
      ) : (
        <input
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          checked={checked}
          className={`w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors ${type === 'checkbox' ? 'w-auto h-4 p-0 ml-1' : ''}`}
        />
      )}
    </div>
  );

/**
 * Section title component with icon.
 */
const SectionTitle = ({ title, Icon, className = "" }) => (
  <h3 className={`text-lg font-semibold text-indigo-600 border-b pb-2 mb-4 mt-8 flex items-center ${className}`}>
      <Icon className="w-5 h-5 mr-2" />
      {title}
  </h3>
);


// --- CUSTOM HOOK ---

/**
 * Custom hook to handle Firebase initialization and user state.
 */
const useAgent = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [savedJobs, setSavedJobs] = useState([]);

  // 1. Initialize Firebase and handle Authentication
  useEffect(() => {
    if (Object.keys(firebaseConfig).length === 0) {
      console.error("Firebase config is missing. Cannot initialize Firebase.");
      return;
    }

    const app = initializeApp(firebaseConfig);
    const firebaseAuth = getAuth(app);
    const firestoreDb = getFirestore(app);

    setDb(firestoreDb);
    setAuth(firebaseAuth);

    // Set up Auth State Listener
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
      if (user) {
        setUserId(user.uid);
        console.log("User authenticated:", user.uid);
      } else {
        try {
          if (initialAuthToken) {
            const credential = await signInWithCustomToken(firebaseAuth, initialAuthToken);
            setUserId(credential.user.uid);
            console.log("Signed in with custom token.");
          } else {
            const credential = await signInAnonymously(firebaseAuth);
            setUserId(credential.user.uid);
            console.log("Signed in anonymously.");
          }
        } catch (error) {
          console.error("Error during initial authentication:", error);
          setUserId(crypto.randomUUID()); 
        }
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []); 

  // 2. Data Listeners (Profile and Saved Jobs)
  useEffect(() => {
    if (isAuthReady && userId && db) {
      // --- Profile Listener ---
      const profileDocRef = doc(db, getUserCollectionPath(userId, 'profile'), 'main');
      const unsubscribeProfile = onSnapshot(profileDocRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
          const loadedProfile = docSnapshot.data();
          // Ensure projects exists in the loaded data
          if (!loadedProfile.projects) {
              loadedProfile.projects = [];
          }
          setProfile(loadedProfile);
          console.log("Profile loaded successfully.");
        } else {
          setProfile(initialProfileState); 
          console.log("No profile found. Please create one.");
        }
      }, (error) => {
        console.error("Error fetching profile:", error);
      });
      
      // --- Saved Jobs Listener ---
      const jobsCollectionRef = collection(db, getUserCollectionPath(userId, 'saved_jobs'));
      const jobsQuery = query(jobsCollectionRef);
      const unsubscribeJobs = onSnapshot(jobsQuery, (snapshot) => {
        const jobs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setSavedJobs(jobs);
        console.log(`${jobs.length} jobs loaded.`);
      }, (error) => {
        console.error("Error fetching saved jobs:", error);
      });

      return () => {
        unsubscribeProfile();
        unsubscribeJobs();
      };
    }
  }, [isAuthReady, userId, db]); 

  // 3. Core LLM Agent Functions

  const callGeminiApi = useCallback(async (payload, isJsonExpected = false) => {
    // API Key is intentionally left blank here; Canvas provides it at runtime
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY; 
    const maxRetries = 5;
    let delay = 1000;
    
    // Using the global constant directly in string interpolation for robust key transmission
    const apiUrlWithKey = `${GEMINI_API_URL}?key=${apiKey}`; 

    for (let i = 0; i < maxRetries; i++) {
      const response = await fetch(apiUrlWithKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        const content = result.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (content) {
            if (isJsonExpected) {
                try {
                    // Attempt direct parse
                    return JSON.parse(content);
                } catch (e) {
                    // Fallback: strip markdown code fences if model outputted markdown text
                    try {
                        const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
                        return JSON.parse(cleaned);
                    } catch (e2) {
                        console.error("Failed to parse JSON response:", e2);
                        console.error("Raw content:", content);
                        throw new Error("Gemini returned invalid JSON format.");
                    }
                }
            }
            return content;
        }
        return isJsonExpected ? [] : "Generation failed to return text.";
      }

      if (response.status === 429 && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        console.warn(`Rate limit exceeded. Retrying in ${delay / 2}ms...`);
      } else {
        const errorText = await response.text();
        console.error("API Error Details:", errorText);
        throw new Error(`Gemini API request failed: ${response.status} - ${errorText}`);
      }
    }
    throw new Error("Gemini API request failed after multiple retries.");

  }, []);


  const generateContentFromGemini = useCallback(async (systemPrompt, userQuery) => {
    if (!profile || savedJobs.length === 0) {
      console.error("Generation error: Profile or Job Data Missing.");
      return "Error: Profile or Job Data Missing. Please complete your profile and save a job.";
    }
    
    console.log("Attempting to call Gemini API for content generation...");
    try {
      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
      };
      
      return await callGeminiApi(payload, false);

    } catch (error) {
      console.error("Error calling Gemini API:", error);
      return `Error generating content: ${error.message}`;
    }
  }, [profile, savedJobs, callGeminiApi]);

  const searchJobsWithGemini = useCallback(async (query) => {
    if (!query) return [];

    console.log(`Attempting to call Gemini API for job search: ${query}`);
    
    const systemInstruction = `
      You are a specialized job search agent. 
      ACTION: You MUST use the Google Search tool to find current, active job listings matching the user's query.
      
      PROCESSING:
      1. Search for specific job openings (e.g., on LinkedIn, Indeed, JobStreet, Glassdoor, company career pages) using the user's query.
      2. CRITICAL: Extract the DIRECT URL (sourceUri) to the specific job posting. 
         - Do NOT return generic search landing pages (e.g., "google.com/search", "indeed.com/jobs", "jobstreet.com.my").
         - Do NOT return pages that default to the user's detected IP location (e.g., "Jobs in Kuala Lumpur") unless the user specifically queried for that location.
         - The URL must lead directly to the specific job details page (often containing a specific Job ID or unique slug).

      3. Synthesize a concise but detailed Job Description based on the search snippets and available page content. Include key skills and requirements.
      4. Return the data strictly as a JSON array.
      
      OUTPUT FORMAT:
      Your response must be a valid JSON array of objects. Do not include explanation text outside the JSON.
      
      EXAMPLE OF CORRECT DATA EXTRACTION:
      Query: "Software Engineer .Net AI"
      Result: [
        { 
          "jobTitle": "Software Engineer - .Net & AI Integration", 
          "companyName": "CardSys Sdn Bhd", 
          "jobDescription": "Full time, RM 4,300 – RM 6,300 per month. Developers/Programmers role focusing on .NET and AI integration...", 
          "sourceUri": "https://my.jobstreet.com/net-developer-jobs/in-Kuala-Lumpur?jobId=88182312&type=standard" 
        }
      ]
      
      CONSTRAINTS:
      - Do not invent jobs. Only return real listings found via search.
      - If the description is brief in the search snippet, summarize the key skills mentioned.
      - Ensure sourceUri is a valid, clickable URL to the specific job (look for jobId parameters or specific slugs).
    `;
    
    try {
      const payload = {
        contents: [{ parts: [{ text: `Find active job listings for: ${query}` }] }],
        tools: [{ "google_search": {} }], 
        systemInstruction: { parts: [{ text: systemInstruction }] },
        // REMOVED generationConfig with responseMimeType to prevent conflict with Tools
      };

      return await callGeminiApi(payload, true);

    } catch (error) {
      console.error("Error calling Gemini Search API:", error);
      return [];
    }
  }, [callGeminiApi]); 

  const refineProfileWithGemini = useCallback(async (profileData, jobDescription) => {
    if (!profileData || !jobDescription) return null;

    console.log("Attempting to call Gemini API for profile refinement...");

    const systemPrompt = `You are a professional profile analyst. Your task is to compare the provided User Profile (summary, skills, experience) with the Job Description (JD). Generate structured suggestions to tailor the profile to the JD. Focus on identifying missing keywords and suggesting improvements to the Professional Summary. Output MUST be in the specified JSON schema.`;
    
    const userQuery = `
      JOB DESCRIPTION (JD):
      ${jobDescription}

      MY CURRENT PROFESSIONAL PROFILE:
      ${JSON.stringify(profileData, null, 2)}

      Analyze and provide the structured refinement suggestions now.
    `;

    try {
      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: PROFILE_REFINE_SCHEMA,
        },
      };

      return await callGeminiApi(payload, true);

    } catch (error) {
      console.error("Error calling Gemini Refinement API:", error);
      return { error: `Refinement failed: ${error.message}` };
    }
  }, [callGeminiApi]);
  
  const processResumeWithGemini = useCallback(async (resumeText) => {
    if (!resumeText) return null;

    console.log("Attempting to call Gemini API to parse resume text...");

    const systemPrompt = `You are a data extraction agent specializing in resumes. Your task is to parse the raw text of the user's resume and extract all structured data points into a single JSON object. Ensure the output strictly conforms to the provided JSON schema. Do not guess; if a field is missing, omit it or leave it blank. For experience entries, try to infer start and end dates (YYYY-MM) or use 'Present'. If no phone/email is found, leave the field as an empty string.`;
    
    const userQuery = `
      RAW RESUME TEXT:
      ---
      ${resumeText}
      ---
      
      Please extract the profile data into the structured JSON format now.
    `;

    try {
      const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESUME_PARSE_SCHEMA,
        },
      };

      const result = await callGeminiApi(payload, true);
      
      // Post-processing to ensure data structure matches the local state expectations
      if (result.skills && !Array.isArray(result.skills)) result.skills = [result.skills].flat().filter(s => s.trim());
      
      if (result.experience) {
          result.experience = result.experience.map(exp => ({
              ...exp,
              // Convert description to array of strings
              description: Array.isArray(exp.description) ? exp.description.flat().filter(d => d.trim()) : (exp.description ? [exp.description].filter(d => d.trim()) : ['']),
              // Set isPresent flag
              isPresent: exp.endDate?.toLowerCase() === 'present',
          })).filter(exp => exp.title || exp.company);
      }
      
      if (result.education) {
          result.education = result.education.filter(edu => edu.institution || edu.degree);
      }
      
      if (result.projects) {
          result.projects = result.projects.filter(proj => proj.projectName || proj.projectDescription);
      }

      return result;

    } catch (error) {
      console.error("Error calling Gemini Resume Parser API:", error);
      return { error: `Resume parsing failed: ${error.message}` };
    }
  }, [callGeminiApi]);


  return { 
    isAuthReady, 
    userId, 
    db, 
    profile, 
    savedJobs,
    generateContentFromGemini,
    searchJobsWithGemini,
    refineProfileWithGemini,
    processResumeWithGemini,
  };
};


// --- PROFILE MANAGER COMPONENT ---

const ProfileManager = ({ profile: initialProfile, db, userId, savedJobs, refineProfileWithGemini, processResumeWithGemini }) => {
  const [profile, setProfile] = useState(initialProfile || initialProfileState);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });
  
  const [selectedJobId, setSelectedJobId] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [refinementResults, setRefinementResults] = useState(null);
  
  // State for Resume Paste
  const [resumeText, setResumeText] = useState('');
  const [isParsing, setIsParsing] = useState(false); 

  const selectedJob = savedJobs.find(j => j.id === selectedJobId);

  useEffect(() => {
    if (initialProfile) {
      setProfile(initialProfile);
    }
  }, [initialProfile]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
    setFeedback({ message: '', type: '' });
  };
  
  // --- Resume Paste and Parsing Logic ---
  const handlePasteAndProcess = async () => {
    if (!resumeText.trim()) {
      setFeedback({ message: 'Please paste your resume text before running the parser.', type: 'error' });
      return;
    }
    
    setIsParsing(true);
    setFeedback({ message: 'AI Agent is analyzing resume text and building profile structure...', type: 'success' });
    
    const parsedProfile = await processResumeWithGemini(resumeText); 
    setIsParsing(false);

    if (parsedProfile && !parsedProfile.error) {
        // Merge the parsed data with the current profile state
        const updatedProfile = {
            ...profile,
            ...parsedProfile,
            // Ensure array fields default to an array containing a single empty string if empty, for form input consistency
            skills: parsedProfile.skills?.length > 0 ? parsedProfile.skills : [''],
            experience: parsedProfile.experience?.length > 0 ? parsedProfile.experience : [],
            projects: parsedProfile.projects?.length > 0 ? parsedProfile.projects : [],
            education: parsedProfile.education?.length > 0 ? parsedProfile.education : [],
        };
        
        setProfile(updatedProfile);
        setFeedback({ message: 'Profile successfully populated from resume data! Review and save.', type: 'success' });
    } else {
        setFeedback({ message: parsedProfile?.error || 'Failed to parse resume content. Try adjusting the pasted text for clarity.', type: 'error' });
    }
  };
  
  // --- Data Handlers ---
  
  const handleExperienceChange = (index, field, value) => {
    const updatedExperience = [...profile.experience];
    let newExp = { ...updatedExperience[index] };

    if (field === 'isPresent') {
        const isCurrentlyPresent = !newExp.isPresent;
        newExp = { 
            ...newExp, 
            isPresent: isCurrentlyPresent, 
            // Set endDate to 'Present' if checked, clear it if unchecked and it was 'Present'
            endDate: isCurrentlyPresent ? 'Present' : (newExp.endDate === 'Present' ? '' : newExp.endDate)
        };
    } else {
        newExp = { ...newExp, [field]: value };
    }
    
    updatedExperience[index] = newExp;
    setProfile(prev => ({ ...prev, experience: updatedExperience }));
  };

  const addExperience = () => {
    setProfile(prev => ({ ...prev, experience: [...prev.experience, newExperienceEntry] }));
  };

  const removeExperience = (index) => {
    setProfile(prev => ({ ...prev, experience: prev.experience.filter((_, i) => i !== index) }));
  };
  
  const handleProjectChange = (index, field, value) => {
      const updatedProjects = [...profile.projects];
      updatedProjects[index] = { ...updatedProjects[index], [field]: value };
      setProfile(prev => ({ ...prev, projects: updatedProjects }));
  };

  const addProject = () => {
      setProfile(prev => ({ ...prev, projects: [...prev.projects, newProjectEntry] }));
  };

  const removeProject = (index) => {
      setProfile(prev => ({ ...prev, projects: prev.projects.filter((_, i) => i !== index) }));
  };

  const handleEducationChange = (index, field, value) => {
    const updatedEducation = [...profile.education];
    updatedEducation[index] = { ...updatedEducation[index], [field]: value };
    setProfile(prev => ({ ...prev, education: updatedEducation }));
  };

  const addEducation = () => {
    setProfile(prev => ({ ...prev, education: [...prev.education, newEducationEntry] }));
  };

  const removeEducation = (index) => {
    setProfile(prev => ({ ...prev, education: prev.education.filter((_, i) => i !== index) }));
  };

  const handleSkillChange = (index, value) => {
    const updatedSkills = [...profile.skills];
    updatedSkills[index] = value;
    setProfile(prev => ({ ...prev, skills: updatedSkills }));
  };
  
  const addSkill = () => {
    setProfile(prev => ({ ...prev, skills: [...prev.skills, ''] }));
  };

  const removeSkill = (index) => {
    const updatedSkills = profile.skills.filter((_, i) => i !== index);
    setProfile(prev => ({ ...prev, skills: updatedSkills.length > 0 ? updatedSkills : [''] }));
  };
  
  const handleDescriptionChange = (expIndex, descIndex, value) => {
    const updatedExperience = [...profile.experience];
    updatedExperience[expIndex].description[descIndex] = value;
    setProfile(prev => ({ ...prev, experience: updatedExperience }));
  };

  const addDescriptionPoint = (expIndex) => {
    const updatedExperience = [...profile.experience];
    updatedExperience[expIndex].description.push('');
    setProfile(prev => ({ ...prev, experience: updatedExperience }));
  };

  const removeDescriptionPoint = (expIndex, descIndex) => {
    const updatedExperience = [...profile.experience];
    const newDescriptions = updatedExperience[expIndex].description.filter((_, i) => i !== descIndex);
    updatedExperience[expIndex].description = newDescriptions.length > 0 ? newDescriptions : [''];
    setProfile(prev => ({ ...prev, experience: updatedExperience }));
  };
  
  // --- Save and Analyze Logic ---

  const getSanitizedProfile = () => {
     const sanitizedExperience = profile.experience
        .map(exp => ({
            ...exp,
            // Ensure end date is 'Present' if the flag is checked, or the input value otherwise
            endDate: exp.isPresent ? 'Present' : exp.endDate,
            description: exp.description.filter(d => d.trim() !== ''),
        }))
        .filter(exp => exp.title.trim() !== '' || exp.company.trim() !== '');
        
    const sanitizedProjects = profile.projects.filter(proj => 
        proj.projectName.trim() !== '' || proj.projectDescription.trim() !== ''
    );
        
    const sanitizedEducation = profile.education.filter(edu => 
        edu.institution.trim() !== '' || edu.degree.trim() !== ''
    );
        
    const sanitizedProfile = {
        ...profile,
        skills: profile.skills.filter(s => s.trim() !== ''),
        experience: sanitizedExperience,
        projects: sanitizedProjects, // Include projects
        education: sanitizedEducation,
    };
    
    if (sanitizedProfile.skills.length === 0) sanitizedProfile.skills = [];
    return sanitizedProfile;
  }

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      setFeedback({ message: 'Database not ready.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setFeedback({ message: '', type: '' });
    
    const sanitizedProfile = getSanitizedProfile();

    try {
      const profileDocRef = doc(db, getUserCollectionPath(userId, 'profile'), 'main');
      await setDoc(profileDocRef, sanitizedProfile);
      setFeedback({ message: 'Profile saved successfully!', type: 'success' });
    } catch (error) {
      console.error("Error saving profile:", error);
      setFeedback({ message: 'Failed to save profile. See console for details.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleRefine = async () => {
    if (!selectedJob) {
      setFeedback({ message: 'Please select a job description to analyze against.', type: 'error' });
      return;
    }
    
    const currentProfile = getSanitizedProfile();

    if (!currentProfile.summary || currentProfile.skills.length === 0) {
        setFeedback({ message: 'Please complete your professional summary and add some skills before refining.', type: 'error' });
        return;
    }

    setIsAnalyzing(true);
    setRefinementResults(null);
    setFeedback({ message: 'AI Agent is analyzing profile vs. Job Description...', type: 'success' });
    
    const results = await refineProfileWithGemini(currentProfile, selectedJob.jobDescription);
    setIsAnalyzing(false);

    if (results && !results.error) {
        setRefinementResults(results);
        setFeedback({ message: 'Analysis complete! Check the refinement suggestions below.', type: 'success' });
    } else {
        setFeedback({ message: results.error || 'AI analysis failed. Try again.', type: 'error' });
    }
  }


  if (!db || !profile) return <div className="p-8 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /> Initializing Profile Manager...</div>;
  

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-indigo-700 mb-6 flex items-center">
        <User className="w-6 h-6 mr-3" />
        Professional Profile Editor
      </h2>
      <FeedbackAlert message={feedback.message} type={feedback.type} />
      
      
      {/* --- RESUME TEXT PASTE TOOL (for PDFs/DOCX) --- */}
      <div className="p-5 border border-indigo-300 rounded-xl bg-indigo-50 shadow-inner">
        <SectionTitle title="Populate from Resume Text" Icon={Clipboard} className="!mt-0 border-b-indigo-400" />
        <p className="text-sm text-gray-700 mb-4">
            **For PDF or DOCX files**, copy the entire text content and paste it below. The AI Agent will parse the unstructured text and auto-fill your profile fields.
        </p>
        <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder="Paste your resume content (from PDF/DOCX) here..."
            rows={6}
            className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-none"
        />
        <button
            onClick={handlePasteAndProcess}
            disabled={!resumeText.trim() || isParsing}
            className="w-full mt-3 flex items-center justify-center py-2 rounded-lg text-white font-bold transition-all space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400"
        >
            {isParsing ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
                <Upload className="w-5 h-5 mr-2" />
            )}
            <span>{isParsing ? 'Parsing Resume Data...' : 'Run AI Resume Parser'}</span>
        </button>
      </div>
      {/* --- END RESUME TEXT PASTE TOOL --- */}
      
      
      {/* --- AI PROFILE REFINEMENT TOOL --- */}
      <div className="p-5 border border-purple-300 rounded-xl bg-purple-50 shadow-inner">
        <SectionTitle title="AI Profile Refinement Tool" Icon={FileBarChart} className="!mt-0 border-b-purple-400" />
        <p className="text-sm text-gray-700 mb-4">Select a saved job below to get personalized, structured advice on how to tailor your profile (summary and skills) to maximize your match likelihood.</p>
        
        <div className="flex space-x-3 items-center">
            <select
              value={selectedJobId}
              onChange={(e) => {
                  setSelectedJobId(e.target.value);
                  setRefinementResults(null); 
              }}
              className="p-2 border border-purple-300 rounded-lg flex-grow shadow-sm"
            >
              <option value="">Select a Job for Analysis</option>
              {savedJobs.map(job => (
                <option key={job.id} value={job.id}>
                  {job.jobTitle} @ {job.companyName}
                </option>
              ))}
            </select>
            <button
                onClick={handleRefine}
                disabled={!selectedJobId || isAnalyzing}
                className="flex items-center text-sm px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:bg-gray-400 font-medium whitespace-nowrap"
            >
                {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
                Analyze Profile ✨
            </button>
        </div>
        
        {/* Refinement Results Display */}
        {refinementResults && (
            <div className="mt-4 p-4 border border-purple-400 rounded-lg bg-white shadow-md space-y-3">
                <h4 className="font-bold text-md text-purple-700">Refinement Suggestions for "{selectedJob?.jobTitle}"</h4>
                
                <div>
                    <p className="font-semibold text-gray-800">Summary Suggestion:</p>
                    <p className="text-sm text-gray-700 italic border-l-4 border-indigo-400 pl-2">
                        {refinementResults.summarySuggestion}
                    </p>
                </div>
                
                <div>
                    <p className="font-semibold text-gray-800">Key Skills to Highlight in Profile:</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                        {refinementResults.keySkillsToHighlight?.map((skill, index) => (
                            <span key={index} className="px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                                {skill}
                            </span>
                        ))}
                    </div>
                </div>

                {refinementResults.missingKeywords.length > 0 && (
                    <div>
                        <p className="font-semibold text-gray-800">Missing Keywords (Consider Adding!):</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                            {refinementResults.missingKeywords.map((keyword, index) => (
                                <span key={index} className="px-3 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                    {keyword}
                                </span>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        )}
      </div>
      {/* --- END AI PROFILE REFINEMENT TOOL --- */}
      
      
      {/* --- FORM SECTIONS START HERE --- */}
      <form onSubmit={handleSaveProfile} className="space-y-6">
        
        {/* --- CORE INFO & CONTACT --- */}
        <div className="p-5 border border-gray-200 rounded-xl bg-gray-50">
          <SectionTitle title="Personal & Contact Information" Icon={User} className="!mt-0" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Full Name" name="name" value={profile.name} onChange={handleChange} placeholder="Jane Doe" />
            <Field label="Email" name="email" type="email" value={profile.email} onChange={handleChange} placeholder="name@example.com" />
            <Field label="Phone" name="phone" value={profile.phone} onChange={handleChange} placeholder="555-123-4567" />
            <Field label="LinkedIn Profile" name="linkedIn" value={profile.linkedIn} onChange={handleChange} placeholder="linkedin.com/in/..." />
          </div>
          <Field label="Professional Summary" name="summary" value={profile.summary} onChange={handleChange} placeholder="A concise summary of your career and goals..." isTextArea />
        </div>

        {/* --- SKILLS --- */}
        <div className="p-5 border border-gray-200 rounded-xl bg-gray-50">
          <SectionTitle title="Key Skills & Technologies" Icon={Briefcase} />
          <p className="text-sm text-gray-600 mb-3">List important skills (e.g., React, Python, Cloud). These are crucial for matching to job descriptions.</p>
          <div className="space-y-2">
            {profile.skills.map((skill, index) => (
              <div key={index} className="flex space-x-2 items-center">
                <input
                  type="text"
                  value={skill}
                  onChange={(e) => handleSkillChange(index, e.target.value)}
                  placeholder="e.g., Python, Figma, Prompt Engineering"
                  className="flex-grow p-2 border border-gray-300 rounded-lg shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => removeSkill(index)}
                  className="p-2 text-red-500 hover:text-red-700 transition-colors rounded-full"
                  title="Remove Skill"
                >
                      <Minus className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addSkill}
            className="mt-3 flex items-center text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          >
            <Plus className="w-4 h-4 mr-1" /> Add Skill
          </button>
        </div>

        {/* --- EXPERIENCE --- */}
        <div className="p-5 border border-gray-200 rounded-xl bg-gray-50">
          <SectionTitle title="Work Experience" Icon={Briefcase} />
          {profile.experience.map((exp, expIndex) => (
            <div key={expIndex} className="p-4 mb-4 border border-indigo-200 rounded-lg bg-white shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-semibold text-gray-800">Experience #{expIndex + 1}</h4>
                <button
                  type="button"
                  onClick={() => removeExperience(expIndex)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                  title="Delete Experience"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <Field label="Job Title" value={exp.title} onChange={(e) => handleExperienceChange(expIndex, 'title', e.target.value)} placeholder="Software Engineer" />
                <Field label="Company" value={exp.company} onChange={(e) => handleExperienceChange(expIndex, 'company', e.target.value)} placeholder="Innovatech Solutions" />
                
                {/* Start Date */}
                <Field label="Start Date" type="month" value={exp.startDate} onChange={(e) => handleExperienceChange(expIndex, 'startDate', e.target.value)} />
                
                {/* End Date / Present Checkbox */}
                <div className="flex flex-col">
                  {/* End Date Input (Hidden if 'Present' is checked) */}
                  {!exp.isPresent && (
                    <Field label="End Date" type="month" value={exp.endDate} onChange={(e) => handleExperienceChange(expIndex, 'endDate', e.target.value)} />
                  )}
                  {/* Present Checkbox */}
                  <div className={`mt-auto ${exp.isPresent ? 'col-span-2' : ''}`}>
                    <label className="flex items-center text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={!!exp.isPresent}
                        onChange={() => handleExperienceChange(expIndex, 'isPresent', !exp.isPresent)}
                        className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 mr-2"
                      />
                      Currently work here
                    </label>
                  </div>
                </div>
              </div>

              {/* Description Points (Bullet Points) */}
              <label className="block text-sm font-medium text-gray-700 mb-2">Key Accomplishments (Use action verbs!)</label>
              <div className="space-y-1">
                {exp.description.map((desc, descIndex) => (
                  <div key={descIndex} className="flex space-x-2 items-center">
                    <input
                      type="text"
                      value={desc}
                      onChange={(e) => handleDescriptionChange(expIndex, descIndex, e.target.value)}
                      placeholder="e.g., Led migration to microservices architecture..."
                      className="flex-grow p-2 border border-gray-300 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeDescriptionPoint(expIndex, descIndex)}
                      className="p-1 text-red-400 hover:text-red-600 transition-colors"
                      title="Remove Bullet Point"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => addDescriptionPoint(expIndex)}
                className="mt-2 text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                + Add Bullet Point
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addExperience}
            className="w-full mt-3 flex items-center justify-center bg-indigo-500 text-white py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium"
          >
            <Plus className="w-5 h-5 mr-2" /> Add New Experience
          </button>
        </div>
        
        {/* --- PROJECTS --- */}
        <div className="p-5 border border-gray-200 rounded-xl bg-gray-50">
          <SectionTitle title="Project Portfolio" Icon={Code} />
          {profile.projects.map((proj, projIndex) => (
            <div key={projIndex} className="p-4 mb-4 border border-indigo-200 rounded-lg bg-white shadow-sm">
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-semibold text-gray-800">Project #{projIndex + 1}</h4>
                <button
                  type="button"
                  onClick={() => removeProject(projIndex)}
                  className="text-red-500 hover:text-red-700 transition-colors"
                  title="Delete Project"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <Field label="Project Name" value={proj.projectName} onChange={(e) => handleProjectChange(projIndex, 'projectName', e.target.value)} placeholder="Personal Portfolio Website" />
                <Field label="Month & Year" value={proj.monthAndYear} onChange={(e) => handleProjectChange(projIndex, 'monthAndYear', e.target.value)} placeholder="01/2024" />
              </div>

              <Field label="Project Description" isTextArea value={proj.projectDescription} onChange={(e) => handleProjectChange(projIndex, 'projectDescription', e.target.value)} placeholder="Briefly describe the technology used and impact/features..." />
            </div>
          ))}
          <button
            type="button"
            onClick={addProject}
            className="w-full mt-3 flex items-center justify-center bg-indigo-500 text-white py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium"
          >
            <Plus className="w-5 h-5 mr-2" /> Add New Project
          </button>
        </div>


        {/* --- EDUCATION --- */}
        <div className="p-5 border border-gray-200 rounded-xl bg-gray-50">
          <SectionTitle title="Education" Icon={User} />
          {profile.education.map((edu, eduIndex) => (
              <div key={eduIndex} className="p-4 mb-4 border border-indigo-200 rounded-lg bg-white shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                      <h4 className="font-semibold text-gray-800">Education #{eduIndex + 1}</h4>
                      <button
                        type="button"
                        onClick={() => removeEducation(eduIndex)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                        title="Delete Education"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Field label="Institution" value={edu.institution} onChange={(e) => handleEducationChange(eduIndex, 'institution', e.target.value)} placeholder="University of Technology" />
                      <Field label="Degree/Certification" value={edu.degree} onChange={(e) => handleEducationChange(eduIndex, 'degree', e.target.value)} placeholder="M.S. Computer Science" />
                      <Field label="Graduation Year" type="number" value={edu.graduationYear} onChange={(e) => handleEducationChange(eduIndex, 'graduationYear', e.target.value)} placeholder="2018" />
                  </div>
              </div>
          ))}
          <button
            type="button"
            onClick={addEducation}
            className="w-full mt-3 flex items-center justify-center bg-indigo-500 text-white py-2 rounded-lg hover:bg-indigo-600 transition-colors font-medium"
          >
            <Plus className="w-5 h-5 mr-2" /> Add New Education
          </button>
        </div>

        {/* --- SAVE BUTTON --- */}
        <button
          type="submit"
          disabled={isSaving}
          className="w-full py-3 rounded-lg text-white font-bold transition-all flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400"
        >
          <Save className="w-5 h-5" />
          <span>{isSaving ? 'Saving Profile...' : 'Save Complete Profile'}</span>
        </button>
      </form>
    </div>
  );
};


// --- JOB MANAGER COMPONENT ---

const JobManager = ({ savedJobs, db, userId, searchJobsWithGemini }) => {
  const [isAdding, setIsAdding] = useState(false); 
  const [isSearching, setIsSearching] = useState(false); 
  const [newJob, setNewJob] = useState(initialNewJobState); 
  const [jobQuery, setJobQuery] = useState(''); 
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });
  const [searchResults, setSearchResults] = useState(null); 
  const [expandedJobId, setExpandedJobId] = useState(null);

  const handleNewJobChange = (e) => {
    const { name, value } = e.target;
    setNewJob(prev => ({ ...prev, [name]: value }));
    setFeedback({ message: '', type: '' });
  };

  const handleAddJob = async (e, jobData = null) => {
    e.preventDefault();
    if (!db || !userId) {
      setFeedback({ message: 'Database not ready.', type: 'error' });
      return;
    }
    
    const dataToSave = jobData || newJob;
    
    if (!dataToSave.jobTitle.trim() || !dataToSave.companyName.trim() || !dataToSave.jobDescription.trim()) {
      setFeedback({ message: 'Job must have a title, company, and description.', type: 'error' });
      return;
    }

    setIsSaving(true);
    setFeedback({ message: '', type: '' });
    
    const finalJobData = {
      ...dataToSave,
      dateSaved: new Date().toISOString(),
    };

    try {
      const jobsCollectionRef = collection(db, getUserCollectionPath(userId, 'saved_jobs'));
      await addDoc(jobsCollectionRef, finalJobData);
      setFeedback({ message: `Job "${finalJobData.jobTitle}" saved successfully!`, type: 'success' });
      setNewJob(initialNewJobState);
      if (!jobData) setIsAdding(false); 
      if (jobData) setSearchResults(null); 
    } catch (error) {
      console.error("Error saving job:", error);
      setFeedback({ message: 'Failed to save job. See console for details.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteJob = async (jobId) => {
    if (!db || !userId) return;

    try {
      const jobDocRef = doc(db, getUserCollectionPath(userId, 'saved_jobs'), jobId);
      await deleteDoc(jobDocRef);
      setFeedback({ message: 'Job deleted successfully.', type: 'success' });
    } catch (error) {
      console.error("Error deleting job:", error);
      setFeedback({ message: 'Failed to delete job. See console for details.', type: 'error' });
    }
  };

  const toggleJobExpansion = (id) => {
    setExpandedJobId(expandedJobId === id ? null : id);
  };
  
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!jobQuery.trim()) {
      setFeedback({ message: 'Please enter a search query.', type: 'error' });
      return;
    }

    setIsSearching(true);
    setSearchResults(null);
    setFeedback({ message: 'Agent is searching for jobs...', type: 'success' });

    const results = await searchJobsWithGemini(jobQuery);
    setIsSearching(false);

    if (results.length > 0) {
      setSearchResults(results);
      setFeedback({ message: `Agent found ${results.length} job results. Review and save them below.`, type: 'success' });
    } else {
      setFeedback({ message: 'Agent could not find any relevant job results.', type: 'error' });
    }
  };

  const JobResultModal = ({ jobs, onClose, onSave }) => {
    if (!jobs || jobs.length === 0) return null;
    
    return (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-75 z-50 overflow-y-auto flex items-start justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8">
          <div className="p-6 border-b flex justify-between items-center">
            <h3 className="text-xl font-bold text-indigo-700 flex items-center">
              <Search className="w-5 h-5 mr-2" /> Agent Search Results ({jobs.length})
            </h3>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-900">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-gray-600">Review the job details generated by the AI agent and click 'Save' to add them to your saved jobs list for document generation.</p>
            {jobs.map((job, index) => (
              <div key={index} className="border border-indigo-200 rounded-lg p-4 bg-indigo-50 shadow-sm">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="font-bold text-lg text-gray-800">{job.jobTitle} @ {job.companyName}</h4>
                  <button
                    onClick={(e) => onSave(e, job)}
                    className="flex items-center text-sm px-3 py-1 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
                  >
                    <Save className="w-4 h-4 mr-1" /> Save
                  </button>
                </div>
                <p className="text-sm font-medium text-indigo-700 mb-2">
                    Source: <a href={job.sourceUri} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline truncate w-64 inline-block">{job.sourceUri || 'N/A'}</a>
                </p>
                <div className="mt-2 p-3 bg-white rounded-lg border border-gray-200 text-sm whitespace-pre-wrap">
                  {job.jobDescription || 'No detailed description available.'}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t flex justify-end">
            <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md h-full space-y-6">
      <h2 className="text-2xl font-bold text-indigo-700 flex items-center">
        <Briefcase className="w-6 h-6 mr-3" />
        AI Job Search Agent
      </h2>
      
      <FeedbackAlert message={feedback.message} type={feedback.type} />
      
      {/* AGENT SEARCH FORM */}
      <form onSubmit={handleSearch} className="p-5 border border-indigo-300 rounded-xl bg-indigo-50 shadow-inner space-y-4">
        <SectionTitle title="Search Jobs with AI Agent" Icon={Search} className="!mt-0 border-b-indigo-400" />
        <Field 
          label="Job Search Query" 
          name="jobQuery" 
          value={jobQuery} 
          onChange={(e) => setJobQuery(e.target.value)} 
          placeholder="e.g., 'Latest Senior React Developer jobs in London'" 
        />
        <button
          type="submit"
          disabled={isSearching}
          className="w-full py-3 rounded-lg text-white font-bold transition-colors flex items-center justify-center space-x-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400"
        >
          {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
          <span>{isSearching ? 'Agent Searching...' : 'Search Jobs with Agent'}</span>
        </button>
      </form>
      
      {/* MANUAL ADD TOGGLE */}
      <button 
        className={`w-full py-3 rounded-lg font-bold transition-colors flex items-center justify-center space-x-2 
          ${isAdding ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
        onClick={() => {
            setIsAdding(!isAdding);
            setFeedback({ message: '', type: '' }); 
        }}
      >
        {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        <span>{isAdding ? 'Cancel Manual Input' : 'Manually Add Job Description'}</span>
      </button>

      {/* Manual Job Form */}
      {isAdding && (
        <form onSubmit={handleAddJob} className="p-5 border border-green-300 rounded-xl bg-green-50 shadow-inner space-y-4">
          <SectionTitle title="Manual Job Details Input" Icon={Briefcase} className="!mt-0 border-b-green-400" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Job Title" name="jobTitle" value={newJob.jobTitle} onChange={handleNewJobChange} placeholder="Software Engineer" />
            <Field label="Company Name" name="companyName" value={newJob.companyName} onChange={handleNewJobChange} placeholder="Innovatech" />
          </div>
          <Field 
            label="Full Job Description (CRITICAL)" 
            name="jobDescription" 
            value={newJob.jobDescription} 
            onChange={handleNewJobChange} 
            placeholder="Paste the entire job description text here." 
            isTextArea 
          />
          <button
            type="submit"
            disabled={isSaving}
            className="w-full py-2 rounded-lg text-white font-bold transition-colors bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400"
          >
            {isSaving ? 'Saving...' : 'Save Job for Generation'}
          </button>
        </form>
      )}

      {/* Saved Jobs List */}
      <SectionTitle title={`Saved Jobs (${savedJobs.length})`} Icon={FileText} />
      <div className="space-y-3 max-h-96 overflow-y-auto p-2 border border-gray-200 rounded-lg">
        {savedJobs.length > 0 ? (
          savedJobs.map((job) => (
            <div key={job.id} className="p-3 border border-gray-200 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
              <div className="flex justify-between items-start">
                <div onClick={() => toggleJobExpansion(job.id)} className="cursor-pointer flex-grow">
                    <p className="font-semibold text-gray-800 flex items-center">
                        {job.jobTitle} at {job.companyName}
                        {expandedJobId === job.id ? <ChevronUp className="w-4 h-4 ml-2 text-gray-400"/> : <ChevronDown className="w-4 h-4 ml-2 text-gray-400"/>}
                    </p>
                    <p className="text-xs text-gray-500 italic">Saved: {new Date(job.dateSaved).toLocaleDateString()}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteJob(job.id)}
                  className="ml-4 p-2 flex-shrink-0 text-red-500 hover:text-red-700 transition-colors rounded-full"
                  title="Delete Job"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              
              <div 
                className={`mt-2 text-sm text-gray-600 cursor-pointer ${expandedJobId === job.id ? '' : 'line-clamp-2'}`}
                onClick={() => toggleJobExpansion(job.id)}
              >
                  {job.jobDescription}
              </div>

              {expandedJobId === job.id && job.sourceUri && (
                  <a 
                      href={job.sourceUri} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="inline-block mt-2 text-xs text-indigo-500 hover:underline font-medium"
                  >
                      View Original Listing &rarr;
                  </a>
              )}
            </div>
          ))
        ) : (
          <p className="text-center text-gray-500 py-8">No jobs saved yet. Search for a job above or add one manually!</p>
        )}
      </div>
      
      {/* Search Results Modal */}
      <JobResultModal 
        jobs={searchResults} 
        onClose={() => setSearchResults(null)} 
        onSave={handleAddJob}
      />
    </div>
  );
};

// Placeholder component for Document Generation (Phase 2)
const Generator = ({ profile, savedJobs, generateContentFromGemini }) => {
  const [generationType, setGenerationType] = useState('coverLetter');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [generatedText, setGeneratedText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });

  const selectedJob = savedJobs.find(j => j.id === selectedJobId);

  const handleCopy = () => {
    if (!generatedText) return;

    // Fallback for secure copy in iframe environments
    const textarea = document.createElement('textarea');
    textarea.value = generatedText;
    textarea.style.position = 'fixed';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            setFeedback({ message: 'Document copied to clipboard!', type: 'success' });
        } else {
            setFeedback({ message: 'Failed to copy document. Please select and copy manually.', type: 'error' });
        }
    } catch (err) {
        setFeedback({ message: 'Copying failed. Please select and copy manually.', type: 'error' });
    }
    document.body.removeChild(textarea);

    setTimeout(() => setFeedback({ message: '', type: '' }), 3000);
  };

  const handleGenerate = async () => {
    if (!profile || !selectedJob) {
      setFeedback({ message: 'Please ensure your profile is complete and a job is selected.', type: 'error' });
      return;
    }

    setIsLoading(true);
    setGeneratedText('');
    setFeedback({ message: 'AI Agent drafting document...', type: 'success' });

    let systemPrompt = "";
    let userQuery = "";

    if (generationType === 'coverLetter') {
      // UPDATED PROMPT FOR CONCISENESS AND PROFESSIONALISM
      systemPrompt = "You are an elite career strategist. Write a sophisticated, persuasive, and professional cover letter. Use elevated business English, strong active voice, and compelling vocabulary. Avoid passive phrasing and overused buzzwords. Structure the letter into three concise paragraphs: 1) A strong opening hook connecting the user's value to the company's needs. 2) Specific, quantified examples of achievements from the user's profile that prove ability to solve the job's key challenges. 3) A confident call to action. Format strictly as a formal business letter.";
    } else {
      // UPDATED PROMPT FOR FULL EXPERIENCE CONTEXT
      systemPrompt = `You are a professional resume editor. Your task is to rewrite the 'Work Experience' section tailored specifically to the provided Job Description (JD). 
      
      For each relevant role in the user's profile:
      1.  **Header:** Display the **Job Title**, **Company Name**, and **Dates** clearly.
      2.  **Bullets:** Write 3-4 bullet points that re-phrase the user's original accomplishments to explicitly highlight skills and keywords required in the JD.
      
      Format the output cleanly. Use strong action verbs. Do NOT include generic introductory text.`;
    }
    
    // Ensure profile data is clean before sending
    const sanitizedProfile = {
        ...profile,
        skills: profile.skills.filter(s => s.trim() !== ''),
        experience: profile.experience.filter(exp => exp.title).map(exp => ({
            ...exp,
            description: exp.description.filter(d => d.trim() !== ''),
        })),
        projects: profile.projects.filter(proj => proj.projectName).map(proj => ({
            ...proj,
            projectDescription: proj.projectDescription.trim(),
        })),
    };

    userQuery = `
      JOB DESCRIPTION (JD):
      ${selectedJob.jobDescription}

      MY PROFESSIONAL PROFILE:
      ${JSON.stringify(sanitizedProfile, null, 2)}

      Please generate the document now.
    `;
    
    const result = await generateContentFromGemini(systemPrompt, userQuery);
    setGeneratedText(result);
    setIsLoading(false);
    setFeedback({ message: 'Generation complete! Review the tailored document below.', type: 'success' });
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md h-full space-y-4">
      <h2 className="text-xl font-semibold text-indigo-700 flex items-center">
        <FileText className="w-5 h-5 mr-2" />
        Document Generator (Phase 2)
      </h2>
      
      <FeedbackAlert message={feedback.message} type={feedback.type} />
      
      {/* Configuration Inputs */}
      <div className="flex space-x-4">
        <select
          value={generationType}
          onChange={(e) => {
              setGenerationType(e.target.value);
              setGeneratedText('');
              setFeedback({ message: '', type: '' });
          }}
          className="p-2 border border-gray-300 rounded-lg flex-1 shadow-sm"
        >
          <option value="coverLetter">Cover Letter</option>
          <option value="resumeDraft">Resume Draft (Relevant Experience)</option>
        </select>
        <select
          value={selectedJobId}
          onChange={(e) => {
              setSelectedJobId(e.target.value);
              setGeneratedText('');
              setFeedback({ message: '', type: '' });
          }}
          className="p-2 border border-gray-300 rounded-lg flex-1 shadow-sm"
        >
          <option value="">Select a Job</option>
          {savedJobs.map(job => (
            <option key={job.id} value={job.id}>
              {job.jobTitle} @ {job.companyName}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!profile || !selectedJobId || isLoading}
        className={`w-full py-3 rounded-lg text-white font-bold transition-all flex items-center justify-center space-x-2 
          ${!profile || !selectedJobId || isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`
        }
      >
        {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
        <span>{isLoading ? 'Generating...' : `Generate ${generationType === 'coverLetter' ? 'Cover Letter' : 'Resume Draft'}`}</span>
      </button>

      {/* Output Area */}
      <div className="mt-4">
        <h3 className="text-lg font-medium mb-2 text-gray-700 flex justify-between items-center">
            <span>Generated Output:</span>
            {generatedText && (
                <button 
                    onClick={handleCopy} 
                    className="flex items-center text-sm px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                    title="Copy to Clipboard"
                >
                    <Clipboard className="w-4 h-4 mr-1" />
                    Copy to Clipboard
                </button>
            )}
        </h3>
        <textarea
          readOnly
          value={generatedText || (isLoading ? "Please wait..." : "Select a job and click Generate to see the result.")}
          rows={15}
          className="w-full p-6 border-2 border-dashed border-gray-300 rounded-lg resize-none bg-white font-mono text-gray-800 focus:ring-indigo-500 focus:border-indigo-500 shadow-inner"
        />
      </div>
    </div>
  );
};


// Main Application Component
export default function App() {
  const { 
    isAuthReady, 
    userId, 
    db, 
    profile, 
    savedJobs,
    generateContentFromGemini,
    searchJobsWithGemini,
    refineProfileWithGemini,
    processResumeWithGemini,
  } = useAgent();
  
  const [activeTab, setActiveTab] = useState('profile');

  const renderContent = () => {
    if (!isAuthReady) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-10">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
          <p className="text-lg text-gray-600">Connecting to Firebase and Authenticating...</p>
        </div>
      );
    }

    const commonProps = { db, userId, profile, savedJobs };
    
    switch (activeTab) {
      case 'profile':
        return <ProfileManager {...commonProps} refineProfileWithGemini={refineProfileWithGemini} processResumeWithGemini={processResumeWithGemini} />;
      case 'jobs':
        return <JobManager {...commonProps} searchJobsWithGemini={searchJobsWithGemini} />;
      case 'generate':
        return <Generator {...commonProps} generateContentFromGemini={generateContentFromGemini} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      <Header />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tab Navigation */}
        <div className="mb-6 flex space-x-1 p-1 bg-white rounded-xl shadow-lg">
          {['profile', 'jobs', 'generate'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-200 
                ${activeTab === tab 
                  ? 'bg-indigo-500 text-white shadow-md' 
                  : 'text-gray-600 hover:bg-gray-50'}`
              }
            >
              {tab === 'profile' && <User className="w-4 h-4 inline-block mr-2" />}
              {tab === 'jobs' && <Briefcase className="w-4 h-4 inline-block mr-2" />}
              {tab === 'generate' && <FileText className="w-4 h-4 inline-block mr-2" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="bg-white p-6 rounded-xl shadow-xl min-h-[70vh]">
          {renderContent()}
        </div>
        
        {/* Footer Info */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Current User ID: <span className="font-mono text-xs">{userId || 'N/A'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}