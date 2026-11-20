import { createEffect, type Component } from "solid-js"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useHost } from "../../host/HostProvider"
import { canUseSpeechToText } from "./availability"

export const SpeechToTextPrewarm: Component = () => {
  const host = useHost()
  const provider = useProvider()
  const { config, features } = useConfig()
  let prepared = false

  createEffect(() => {
    if (prepared || !host.capabilities.speech) return
    if (!canUseSpeechToText(config(), provider.authStates(), features().speechToText)) return
    prepared = true
    host.post({ type: "speechToTextPrewarm" })
  })

  return null
}
