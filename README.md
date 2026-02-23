# Knowledge Habit Tracker 🏃‍♂️

A privacy-focused, offline-first habit tracking system designed specifically for knowledge workers and lifelong learners. Integrates seamlessly with the Dragon Palace Knowledge Hub.

## 🌟 Features

- **Knowledge-Focused Habits**: Track habits related to learning, reading, coding, writing, and other knowledge activities
- **Time Integration**: Synchronized with time management systems to optimize habit scheduling
- **Knowledge Correlation**: Link habits to knowledge acquisition and contribution activities
- **Offline-First**: Pure local operation with no external dependencies or data collection
- **Privacy by Design**: All habit data stays on your device
- **Light-up Events**: Celebrate habit milestones as "light-up" events in your knowledge network
- **Data Export**: Export habit data for analysis and integration with other tools

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/knowledge-habit-tracker.git
cd knowledge-habit-tracker

# Install dependencies
npm install

# Start the habit tracker
chmod +x start.sh
./start.sh

# Access in your browser
http://localhost:3000
```

## 🔗 Integration with Knowledge Hub

The Knowledge Habit Tracker is designed to work alongside the [Dragon Palace Knowledge Hub](https://github.com/your-username/dragon-palace-knowledge-hub):

- **Shared Data Model**: Both systems use compatible data structures for seamless integration
- **Unified Interface**: Can be deployed together on the same port (3000) for unified access
- **Knowledge Events**: Habit achievements automatically generate knowledge events
- **Time Correlation**: Analyze how time management affects habit consistency

## 🏗️ Architecture

### Core Components
- **Habit Tracker**: Core habit tracking and visualization logic
- **Time Manager**: Integrated time block planning and scheduling
- **Knowledge Connector**: API layer for integration with knowledge platforms
- **Local Storage**: Browser-based storage with optional file system backup

### Technical Stack
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Node.js with Express (optional, for advanced features)
- **Storage**: localStorage with IndexedDB fallback
- **Visualization**: Canvas-based charts and heatmaps

## 📄 Documentation

- [Getting Started Guide](docs/getting-started.md)
- [API Reference](docs/api.md)
- [Integration Guide](docs/integration.md)
- [Data Model](docs/data-model.md)

## 🤝 Contributing

Contributions are welcome! Please see our [Contribution Guidelines](CONTRIBUTING.md).

## 📜 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

Built as part of the OpenClaw ecosystem.
Inspired by atomic habits and knowledge worker productivity principles.