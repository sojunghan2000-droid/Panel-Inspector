import { GoogleGenAI, Type } from "@google/genai";

// Vite 공식 문법인 import.meta.env를 써야 합니다.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

export const analyzeInspectionPhoto = async (base64Image: string): Promise<{ loads: string[], safetyNotes: string }> => {
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is not set. Please configure it in your .env file.");
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    // Remove header if present (e.g., "data:image/jpeg;base64,")
    const cleanBase64 = base64Image.split(',')[1] || base64Image;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64
            }
          },
          {
            text: `Analyze this image of a construction site distribution board. 
            1. Identify if any of the following equipment is connected or visible nearby: Welder, Grinder, Temporary Light, Water Pump.
            2. Provide a brief safety assessment (max 2 sentences).
            
            Return JSON.`
          }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            detectedLoads: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "List of detected equipment: 'welder', 'grinder', 'light', 'pump'"
            },
            safetyAssessment: {
              type: Type.STRING,
              description: "Brief safety observation."
            }
          }
        }
      }
    });

    let jsonText = response.text || "{}";
    
    // Clean up if the model wrapped the JSON in markdown code blocks
    if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```(json)?\n/, "").replace(/\n```$/, "");
    }

    const data = JSON.parse(jsonText);
    
    return {
      loads: data.detectedLoads || [],
      safetyNotes: data.safetyAssessment || "No specific safety issues detected."
    };

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    throw new Error("Failed to analyze image with AI.");
  }
};