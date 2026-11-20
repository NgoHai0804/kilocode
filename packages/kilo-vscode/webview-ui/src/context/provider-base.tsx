import type { ParentComponent } from "solid-js"
import { ThemeProvider } from "@kilocode/kilo-ui/theme"
import { DialogProvider } from "@kilocode/kilo-ui/context/dialog"
import { Toast } from "@kilocode/kilo-ui/toast"
import { VSCodeProvider } from "./vscode"
import { ServerProvider } from "./server"
import { LanguageBridge } from "./language-bridge"
import { ProviderProvider } from "./provider"
import { ConfigProvider } from "./config"
import { DisplayProvider } from "./display"
import { SpeechToTextPrewarm } from "../components/speech-to-text/SpeechToTextPrewarm"

export const Base: ParentComponent<{ content?: ParentComponent; host?: ParentComponent; theme?: string }> = (props) => {
  const Content = props.content ?? ((props) => props.children)
  const Host = props.host ?? VSCodeProvider
  return (
    <ThemeProvider defaultTheme={props.theme ?? "kilo-vscode"}>
      <DialogProvider>
        <Host>
          <ServerProvider>
            <LanguageBridge>
              <Content>
                <ProviderProvider>
                  <ConfigProvider>
                    <SpeechToTextPrewarm />
                    <DisplayProvider>{props.children}</DisplayProvider>
                  </ConfigProvider>
                </ProviderProvider>
              </Content>
            </LanguageBridge>
          </ServerProvider>
        </Host>
        <Toast.Region />
      </DialogProvider>
    </ThemeProvider>
  )
}
