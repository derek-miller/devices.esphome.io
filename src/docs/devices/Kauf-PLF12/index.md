---
title: KAUF Power Monitoring Smart Plug (PLF12)
date-published: 2026-07-26
type: plug
standard: us
board: esp8266
difficulty: 1
project-url: https://github.com/KaufHA/PLF12
---

## Product Description

The KAUF PLF12 is the newer of Kauf's two US 120 V smart plugs. Like the [PLF10](/devices/kauf-plf10/) it ships
running ESPHome, so there is nothing to flash, solder or disassemble — it can be adopted into ESPHome Device
Builder over Wi-Fi. Inside is an ESP8266 with a relay rated for a 15 amp resistive load, BL0937 power monitoring,
a button, and red and blue LEDs.

Kauf notes the plug is not appropriate for large capacitive or inductive loads, which includes things like water
and air pumps.

The PLF12 has its plug on the left and the button on the right, with the LEDs inside the button. It is a
different board from the PLF10 — different pinout, different power monitoring chip — and firmware is not
interchangeable between the two.

## GPIO Pinout

| Pin    | Function                              |
| ------ | ------------------------------------- |
| GPIO1  | Red LED (active low, UART TX)         |
| GPIO3  | Button (pull-up, active low, UART RX) |
| GPIO4  | BL0937 CF                             |
| GPIO5  | BL0937 CF1                            |
| GPIO12 | Blue LED (active low)                 |
| GPIO13 | Relay                                 |
| GPIO14 | BL0937 SEL (inverted)                 |

Because the button and the red LED are on GPIO3 and GPIO1, the serial logger must be disabled
(`logger: baud_rate: 0`). Leaving it enabled drives the LED and makes the button unreliable.

## Basic Configuration

```yaml file=config.yaml
```

## Taking Control

The plug arrives running Kauf's own ESPHome build. To move it to your own ESPHome instance, either adopt it from
the ESPHome Device Builder dashboard, or point your configuration at Kauf's yaml as a package so their updates
keep flowing:

```yaml inline
packages:
  kauf.plf12: github://KaufHA/PLF12/kauf-plf12.yaml
```

Holding the button for 30 seconds re-enables the access point and captive portal, which is how you recover a plug
that can no longer reach your network.

## Upstream Configuration

The full firmware Kauf ships. It layers the PLF12's pinout and BL0937 calibration over the shared PLF10 base
configuration:

```yaml url=https://github.com/KaufHA/PLF12/blob/main/config/kauf-plf12-base.yaml
```
