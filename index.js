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

// JST verify
// const verifyFBToken = (req, res, next) => {
//     // console.log('token in the middleware', req.headers.authorization)
//     const token = req.headers.authorization.split(' ')[1];
//     console.log('token', token)
//     if (!token) {
//         return res.status(401).send({ message: 'Unauthorized' })
//     }
//     next()
// }

const verifyFBToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    // 1. Check header exists
    if (!authHeader) {
        return res.status(401).json({ message: 'No Authorization header found' });
    }

    // 2. Check format is correct (Bearer token)
    if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: 'Invalid Authorization format' });
    }

    // 3. Extract token safely
    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: 'Token missing' });
    }

    console.log("token", token);

    next();
};


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
        const ordersCollection = db.collection('orders')

        // users related apis
        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log('user received', user)
            const photoURL = req.body.photoURL;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const userExists = await usersCollection.findOne({ email })

            if (userExists) {
                return res.send({ message: 'user exists' })
            }
            user.photoURL = photoURL || null
            const result = await usersCollection.insertOne(user);
            res.send(result);
        })
        app.get('/users', async (req, res) => {
            const cursor = usersCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        })
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        })

        // Post--send data to db 
        app.post('/books', async (req, res) => {
            const newBook = req.body;
            const result = await booksCollection.insertOne(newBook);
            res.send(result)
        })

        // Get all books
        app.get('/books', verifyFBToken, async (req, res) => {
            const cursor = booksCollection.find();
            console.log('headers', req.headers)
            const result = await cursor.toArray();
            res.send(result);
        })

        // GET single book by ID
        app.get('/books/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const book = await booksCollection.findOne({ _id: new ObjectId(id) });
                if (!book) return res.status(404).send({ message: 'Book not found' });
                res.send(book);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Error fetching book' });
            }
        });

        // PUT update book by ID
        app.put('/books/:id', async (req, res) => {
            const id = req.params.id;
            const updatedBook = req.body;
            try {
                const result = await booksCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedBook }
                );
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Error updating book' });
            }
        });

        // DELETE book by ID
        app.delete('/books/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const result = await booksCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Error deleting book' });
            }
        });

        // Orders related apis
        app.post('/orders', async (req, res) => {
            const customerName = req.body.customerName;
            const customerEmail = req.body.customerEmail;
            const order = req.body;
            order.createdAt = new Date();
            order.customerName = customerName;
            order.customerEmail = customerEmail;
            order.status = 'pending';
            order.paymentStatus = 'pending';
            const result = await ordersCollection.insertOne(order);
            res.send(result);
        })
        app.get('/orders/:email', async (req, res) => {
            const email = req.params.email;
            const result = await ordersCollection.find({ customerEmail: email }).toArray();
            res.send(result);
        });


        app.get('/orders', async (req, res) => {
            const cursor = ordersCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });

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