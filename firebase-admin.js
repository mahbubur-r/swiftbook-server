const admin = require("firebase-admin");
require('dotenv').config();

// Attempt to initialize with credentials from environment
// Best practice: Set GOOGLE_APPLICATION_CREDENTIALS environment variable to the path of your JSON key file.
// Or you can construct the object manually if you have the values in .env

try {
    admin.initializeApp({
        credential: admin.credential.applicationDefault()
    });
    console.log("Firebase Admin Initialized successfully.");
} catch (error) {
    console.error("Firebase Admin Initialization Error:", error);
}

module.exports = admin;
