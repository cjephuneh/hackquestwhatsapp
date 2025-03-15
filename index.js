const express = require('express');
const twilio = require('twilio');
const bodyParser = require('body-parser');
const { OpenAI } = require('openai');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();


const app = express();

// Middleware to parse incoming requests
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Twilio Credentials (should be in .env for security)
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(twilioAccountSid, twilioAuthToken);

// OpenAI API setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Route to handle incoming WhatsApp voice messages
app.post('/whatsapp/voice', async (req, res) => {
    try {
        console.log('Incoming request:', {
            messageType: req.body.MessageType,
            hasMedia: req.body.NumMedia !== '0',
            from: req.body.From
        });

        // Handle button messages
        if (req.body.MessageType === 'button') {
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You're an English teacher." },
                    { role: "user", content: `User clicked: ${req.body.ButtonText}` }
                ]
            });

            await client.messages.create({
                body: completion.choices[0].message.content,
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: req.body.From
            });

            return res.status(200).send();
        }

        // Handle voice messages
        if (req.body.MessageType === 'audio' && req.body.MediaUrl0) {
            const audioResponse = await axios.get(req.body.MediaUrl0, {
                responseType: 'arraybuffer',
                auth: {
                    username: process.env.TWILIO_ACCOUNT_SID,
                    password: process.env.TWILIO_AUTH_TOKEN
                },
                headers: {
                    'Content-Type': req.body.MediaContentType0
                }
            });

            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            const tempFile = path.join(tempDir, `temp-${Date.now()}.ogg`);
            fs.writeFileSync(tempFile, audioResponse.data);

            const transcript = await openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFile),
                model: "whisper-1"
            });

            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are EduLink, a smart and friendly AI assistant dedicated to linking students with donors and sponsors through EduChain, a blockchain-powered education funding platform. You guide students on how to apply for scholarships, connect with potential sponsors, and manage their funding securely using MetaMask for seamless transactions.Your responses should be clear, engaging, and inspiring, encouraging students to take advantage of opportunities while educating them on how blockchain and smart contracts ensure secure, transparent, and efficient funding.You can explain how EduChain works, how to set up MetaMask, how students receive funding, and how donors can contribute, making complex blockchain concepts easy to understand. Be friendly, encouraging, and solution-oriented—your goal is to empower students and sponsors to create a better future through decentralized education funding! do everything in english" },
                    { role: "user", content: transcript.text }
                ]
            });

            await client.messages.create({
                body: completion.choices[0].message.content,
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: req.body.From
            });

            fs.unlinkSync(tempFile);
            return res.status(200).send();
        }

        // Handle text messages
        if (req.body.Body) {
            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are EduLink, a smart and friendly AI assistant dedicated to linking students with donors and sponsors through EduChain, a blockchain-powered education funding platform. You guide students on how to apply for scholarships, connect with potential sponsors, and manage their funding securely using MetaMask for seamless transactions.Your responses should be clear, engaging, and inspiring, encouraging students to take advantage of opportunities while educating them on how blockchain and smart contracts ensure secure, transparent, and efficient funding.You can explain how EduChain works, how to set up MetaMask, how students receive funding, and how donors can contribute, making complex blockchain concepts easy to understand. Be friendly, encouraging, and solution-oriented—your goal is to empower students and sponsors to create a better future through decentralized education funding! do everything in english" },
                    { role: "user", content: req.body.Body }
                ]
            });

            await client.messages.create({
                body: completion.choices[0].message.content,
                from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
                to: req.body.From
            });

            return res.status(200).send();
        }

        return res.status(400).json({ 
            error: 'Unsupported message type',
            received: {
                type: req.body.MessageType,
                hasMedia: req.body.NumMedia !== '0'
            }
        });

    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: error.message });
    }
});
  
app.get('/', (req, res) => {
    res.send('WhatsApp Voice Assistant API');
});

// Function to get transcription from Twilio (using their recording URL)
async function getTranscription(recordingUrl) {
  try {
    const recordingSid = recordingUrl.split('/').pop(); // Extract the SID from the URL
    const recording = await client.recordings(recordingSid).fetch();

    if (recording.status === 'completed') {
      // Get the transcription of the recording
      const transcription = await client.transcriptions.create({
        recordingSid: recordingSid,
      });

      return transcription.transcriptionText;
    } else {
      throw new Error('Recording is not completed yet');
    }
  } catch (error) {
    console.error('Error fetching transcription:', error);
    throw new Error('Failed to fetch transcription');
  }
}

// Function to generate a response from OpenAI's GPT model
async function generateAIResponse(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: text }],
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating AI response:', error);
    throw new Error('Failed to generate AI response');
  }
}

// Function to send text response to WhatsApp user
async function sendWhatsAppTextResponse(aiResponse, toPhoneNumber) {
  try {
    await client.messages.create({
      body: aiResponse,  // Send the text response
      from: `whatsapp:${twilioPhoneNumber}`,  // Your Twilio WhatsApp number
      to: `whatsapp:${toPhoneNumber}`,  // The phone number that sent the message
    });
    console.log('Text response sent to WhatsApp');
  } catch (error) {
    console.error('Error sending text response:', error);
  }
}

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});