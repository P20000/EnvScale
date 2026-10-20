const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory data store for testing
let todos = [
  { id: '1', title: 'Verify Minikube Cluster Connection', completed: true },
  { id: '2', title: 'Test Ingress Path Routing (/ -> Frontend, /api -> Backend)', completed: true },
  { id: '3', title: 'Inspect Real-Time Pod Stream in EnvScale UI', completed: false },
  { id: '4', title: 'Inject Chaos Fault or Trigger Log Tailing', completed: false }
];

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// GET /api/todos (and /todos for direct fallback)
const getTodosHandler = (req, res) => {
  res.json(todos);
};
app.get('/api/todos', getTodosHandler);
app.get('/todos', getTodosHandler);

// POST /api/todos
const createTodoHandler = (req, res) => {
  const { title } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  const newTodo = {
    id: Date.now().toString(),
    title,
    completed: false
  };
  todos.unshift(newTodo);
  res.status(201).json(newTodo);
};
app.post('/api/todos', createTodoHandler);
app.post('/todos', createTodoHandler);

// PUT /api/todos/:id
const updateTodoHandler = (req, res) => {
  const { id } = req.params;
  const { completed, title } = req.body;
  const todo = todos.find(t => t.id === id);

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  if (typeof completed === 'boolean') todo.completed = completed;
  if (title) todo.title = title;

  res.json(todo);
};
app.put('/api/todos/:id', updateTodoHandler);
app.put('/todos/:id', updateTodoHandler);

// DELETE /api/todos/:id
const deleteTodoHandler = (req, res) => {
  const { id } = req.params;
  todos = todos.filter(t => t.id !== id);
  res.json({ success: true, id });
};
app.delete('/api/todos/:id', deleteTodoHandler);
app.delete('/todos/:id', deleteTodoHandler);

app.listen(PORT, () => {
  console.log(`[Testing Backend] Todo API Server running on port ${PORT}`);
});
