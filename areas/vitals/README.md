# Vitals

Spot readings other than blood pressure: oxygen saturation, temperature,
resting heart rate. One entry holds whatever was read together.

## How it's said

- "SpO2 96 temp 97.9" → spo2 96, temp 97.9
- "oxygen 94" / "O2 sat 97" → spo2
- "temperature 99.1" / "running a fever, 100.4" → temp
- "resting heart rate 62" → heart_rate

## Rules

- Temperature is Fahrenheit. A Celsius reading (e.g. "37.2") is converted and
  the original noted in `notes`.
- A pulse said with a blood pressure reading belongs to **blood-pressure**,
  not here.
- Weight goes to **weight**.
