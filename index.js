const express = require('express');
const cors = require('cors');
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const port = process.env.PORT || 3000;

// console.log(process.env);

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.xr2sv5h.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
// normal get
app.get('/', (req, res) => {
    res.send('SwiftBook server is running')
})
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        // Send the info to the db
        const db = client.db('swiftbook_db');
        // database collections
        const booksCollection = db.collection('books');
        const usersCollection = db.collection('users')

        // login users API from login 
        app.post('/users', async (req, res) => {
            const newUser = req.body;
            const email = req.body.email;
            const query = { email: email }
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                res.send({ message: 'user already exits. do not need to insert again' })
            }
            else {
                const result = await usersCollection.insertOne(newUser);
                res.send(result);
            }
        })

        // Post--send data to db 
        app.post('/books', async (req, res) => {
            const newBook = req.body;
            const result = await booksCollection.insertOne(newBook);
            res.send(result)
        })

        // Get all books
        app.get('/books', async (req, res) => {
            const cursor = booksCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
    }
}

run().catch(console.dir);


app.listen(port, () => {
    console.log(`SwiftBook server is running on port: ${port}`);

})