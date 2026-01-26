/**
 * Google Gemini AI Service
 * Handles AI design generation and extraction using Google Gemini API
 * 
 * API Documentation: https://ai.google.dev/
 */

const { GoogleGenAI } = require('@google/genai');

class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.enabled = !!this.apiKey;
    
    if (!this.enabled) {
      console.warn('[GeminiService] GEMINI_API_KEY not configured. AI design features disabled.');
      return;
    }

    try {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    } catch (error) {
      console.error('[GeminiService] Failed to initialize Gemini client:', error);
      this.enabled = false;
    }
  }

  /**
   * Generate an apparel design using Gemini AI
   * @param {Object} options - Design generation options
   * @param {string} options.apparel_type - Type of apparel (e.g., "T-Shirt", "Hoodie")
   * @param {string} [options.theme_concept] - Theme or concept for the design
   * @param {string} [options.print_placement] - Print placement location
   * @param {string} [options.main_elements] - Main elements to include
   * @param {string} [options.preferred_colors] - Preferred color scheme
   * @returns {Promise<{success: boolean, image?: string, error?: string}>}
   */
  async generateDesign(options) {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Gemini AI service is not configured'
      };
    }

    const {
      apparel_type,
      theme_concept,
      print_placement,
      main_elements,
      preferred_colors
    } = options;

    if (!apparel_type) {
      return {
        success: false,
        error: 'Apparel type is required'
      };
    }

    try {
      // Build comprehensive prompt from all form data
      let prompt = `Generate a high-quality apparel design for a ${apparel_type}. `;
      
      // Image specifications: Fixed layout, aspect ratio, and angle
      prompt += `IMPORTANT IMAGE SPECIFICATIONS: The image must have a fixed 1:1 square aspect ratio (equal width and height). The apparel must be shown from a front-facing, straight-on view only - absolutely no side angles, no angled perspectives, no 3/4 views, no profile views. The garment should be displayed flat or on a model facing directly forward, centered in the frame. `;
      
      if (theme_concept) {
        prompt += `Theme: ${theme_concept}. `;
      }
      
      if (print_placement) {
        prompt += `Print placement: ${print_placement}. `;
      }
      
      if (main_elements) {
        prompt += `Main elements to include: ${main_elements}. `;
      }
      
      if (preferred_colors) {
        prompt += `Use these colors: ${preferred_colors}. `;
      }
      
      prompt += `Create a professional, print-ready design suitable for apparel manufacturing. The design should be visually appealing and appropriate for the target audience. Maintain consistent layout and composition across all generated designs.`;

      // Try different model names for image generation
      const possibleModels = ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'];
      
      let imageData = null;
      let lastError = null;

      for (const modelName of possibleModels) {
        try {
          // Generate image using the model
          const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
          });

          // Extract the image from the response
          if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                // Check for inline data (image)
                if (part.inlineData) {
                  const inlineData = part.inlineData;
                  imageData = inlineData.data || inlineData;
                  break;
                }
              }
            }
          }

          if (imageData) {
            break; // Successfully got image data
          }
        } catch (err) {
          lastError = err;
          console.error(`[GeminiService] Error with model ${modelName}:`, err);
          continue; // Try next model
        }
      }

      if (!imageData) {
        return {
          success: false,
          error: 'Failed to generate image. Please check your API key and model availability.',
          details: lastError?.message || 'No image data returned from any model',
          attemptedModels: possibleModels
        };
      }

      // Convert imageData to base64 if it's not already
      let base64Image = imageData;
      if (typeof imageData === 'string' && !imageData.startsWith('data:')) {
        base64Image = `data:image/png;base64,${imageData}`;
      } else if (Buffer.isBuffer(imageData)) {
        base64Image = `data:image/png;base64,${imageData.toString('base64')}`;
      }

      return {
        success: true,
        image: base64Image
      };
    } catch (error) {
      console.error('[GeminiService] Error generating design:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate design',
        details: error.toString()
      };
    }
  }

  /**
   * Extract design pattern from an apparel image using Gemini AI
   * @param {Object} options - Extraction options
   * @param {string} options.imageUrl - URL of the image to extract design from
   * @returns {Promise<{success: boolean, image?: string, error?: string}>}
   */
  async extractDesign(options) {
    if (!this.enabled) {
      return {
        success: false,
        error: 'Gemini AI service is not configured'
      };
    }

    const { imageUrl } = options;

    if (!imageUrl) {
      return {
        success: false,
        error: 'Image URL is required'
      };
    }

    try {
      // Fetch the image from URL and convert to base64 for Gemini
      let base64Data;
      
      try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          throw new Error('Failed to fetch image from URL');
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        base64Data = buffer.toString('base64');
      } catch (error) {
        return {
          success: false,
          error: `Failed to fetch image: ${error.message}`
        };
      }

      // Build prompt to extract only the design
      const prompt = `Analyze this image of an apparel item (shirt, hoodie, jeans, etc.) with a design printed on it. 

Your task is to extract ONLY the design/graphic/pattern that is printed on the garment. 

IMPORTANT REQUIREMENTS:
1. Remove the entire garment/clothing item - do not show any fabric, sleeves, collar, or clothing structure
2. Extract ONLY the printed design, graphic, text, pattern, or artwork
3. The output should be the design element isolated on a transparent or white background
4. Maintain the exact colors, text, graphics, and visual elements from the original design
5. The design should be centered and properly cropped to show only the design area
6. Output format: Square aspect ratio (1:1) with the design centered
7. If there are multiple design elements (front and back), extract them separately or show the main design element
8. Preserve all text, logos, graphics, and visual details exactly as they appear

Generate an image that contains ONLY the extracted design, ready for use in manufacturing/printing.`;

      // Try different model names for image generation
      const possibleModels = [
        'gemini-3-pro-image-preview', 
        'gemini-2.5-flash-image',
        'gemini-1.5-pro',
        'gemini-1.5-flash'
      ];
      
      let imageData = null;
      let lastError = null;

      for (const modelName of possibleModels) {
        try {
          // Generate image using the model with the original image as input
          const response = await this.ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: 'image/png'
                    }
                  },
                  { text: prompt }
                ]
              }
            ],
          });

          // Extract the image from the response
          if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                // Check for inline data (image)
                if (part.inlineData) {
                  const inlineData = part.inlineData;
                  imageData = inlineData.data || inlineData;
                  break;
                }
              }
            }
          }

          if (imageData) {
            break; // Successfully got image data
          }
        } catch (err) {
          lastError = err;
          console.error(`[GeminiService] Error with model ${modelName}:`, err);
          continue; // Try next model
        }
      }

      if (!imageData) {
        return {
          success: false,
          error: 'Failed to extract design. Please try again.',
          details: lastError?.message || 'No image data returned from any model',
          attemptedModels: possibleModels
        };
      }

      // Convert imageData to base64 format
      let base64Image;
      if (typeof imageData === 'string' && !imageData.startsWith('data:')) {
        base64Image = `data:image/png;base64,${imageData}`;
      } else if (Buffer.isBuffer(imageData)) {
        base64Image = `data:image/png;base64,${imageData.toString('base64')}`;
      } else {
        base64Image = imageData;
      }

      return {
        success: true,
        image: base64Image
      };
    } catch (error) {
      console.error('[GeminiService] Error extracting design:', error);
      return {
        success: false,
        error: error.message || 'Failed to extract design',
        details: error.toString()
      };
    }
  }
}

// Export singleton instance
module.exports = new GeminiService();

