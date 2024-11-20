const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');
const path = require('path');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));

// Watson Speech to Text credentials
const watsonSpeechToTextUrl = process.env.WATSON_SPEECH_TO_TEXT_URL;
const watsonSpeechToTextApiKey = process.env.WATSON_SPEECH_TO_TEXT_API_KEY;

// HubSpot Access Token
const ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;

// Store calls and conversations in memory
app.locals.currentCall = null;
app.locals.pastCalls = [];
app.locals.conversations = [];
app.locals.pastConversations = [];  // Store completed conversations

// Serve the index.html file at the root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Handle incoming calls
app.post('/voice', async (req, res) => {
  const callSid = req.body.CallSid;
  const caller = req.body.From;
  const startTime = new Date();

  console.log(`Incoming call from ${caller} with CallSid ${callSid}`);

  // Initialize current call
  app.locals.currentCall = {
    caller,
    callSid,
    startTime,
    duration: 0,
    status: 'in-progress',
    contactDetails: null, // Placeholder for contact details
  };

  try {
    const contactDetails = await searchByPhoneNumber(caller); // Fetch contact details
    if (contactDetails) {
      app.locals.currentCall.contactDetails = contactDetails; // Attach details
    }
  } catch (error) {
    console.error('Error fetching contact details:', error.message);
  }

  // Respond with TwiML
  const response = new twiml.VoiceResponse();
  response.say('Hello, please tell me something.');

  response.gather({
    input: 'speech',
    action: '/process-speech',
    method: 'POST',
    timeout: 5,
  });

  res.type('text/xml');
  res.send(response.toString());
});



async function searchByPhoneNumber(phone) {
  try {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts/search`;

    const query = {
      filterGroups: [{
        filters: [{ propertyName: "phonenumber", operator: "EQ", value: phone }]
      }],
      properties: ['firstname', 'lastname', 'city', 'message', 'accountnumbers', 'phonenumber'],
    };

    const response = await axios.post(url, query, {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const contacts = response.data.results;
    return contacts.length > 0 ? contacts[0].properties : null;
  } catch (error) {
    console.error('Error searching contacts:', error.response?.data || error.message);
    return null;
  }
}

// Process speech input
app.post('/process-speech', async (req, res) => {
  const speechResult = req.body.SpeechResult;
  console.log(`Speech input received: ${speechResult}`);

  // Simulate a response based on user input
  let botResponse = 'Thank you. Goodbye!';

  // Log the conversation
  app.locals.conversations.push({
    user: speechResult,
    bot: botResponse,
  });

  // Respond with TwiML
  const response = new twiml.VoiceResponse();
  response.say(botResponse);
  response.hangup();

  // Update call status to "completed" and move to pastCalls
  if (app.locals.currentCall) {
    const currentCall = app.locals.currentCall;
    const callDuration = Math.floor((new Date() - currentCall.startTime) / 1000);
    currentCall.duration = callDuration;
    currentCall.status = 'completed';

    // Store conversation history with the completed call
    currentCall.conversations = app.locals.conversations;

    // Add to past calls
    app.locals.pastCalls.push(currentCall);
    
    // Clear current call and conversations for the next one
    app.locals.currentCall = null;
    app.locals.conversations = [];
  }

  res.type('text/xml');
  res.send(response.toString());
});



// Endpoint to serve call and conversation data
app.get('/call-data', (req, res) => {
  // Calculate live duration for an ongoing call
  if (app.locals.currentCall && app.locals.currentCall.status === 'in-progress') {
    app.locals.currentCall.duration = Math.floor(
      (new Date() - app.locals.currentCall.startTime) / 1000
    );
  }

  res.json({
    currentCall: app.locals.currentCall,
    pastCalls: app.locals.pastCalls,
    conversations: app.locals.conversations,
    pastConversations: app.locals.pastConversations,
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

