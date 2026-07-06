# AI Gateway

## App Idea

AI Gateway is a lightweight, local-first API gateway that exposes a single OpenAI-compatible endpoint while intelligently routing requests across multiple API keys and AI providers.

It automatically selects the best available API key, distributes requests to avoid per-key rate limits, retries transient failures, and temporarily removes unhealthy keys from rotation before restoring them automatically.

The gateway is designed for a single developer running it locally, requiring minimal configuration and no cloud services, subscriptions, user accounts, or unnecessary features. It acts as a transparent proxy, allowing any OpenAI-compatible application (such as VS Code extensions, AI coding agents, or custom applications) to connect through one endpoint while the gateway manages provider selection, API key rotation, rate-limit awareness, retries, health monitoring, and request routing behind the scenes.

The primary goal is reliability, simplicity, and maintainability—not feature richness—providing a stable foundation for using multiple API keys and providers through one consistent interface.