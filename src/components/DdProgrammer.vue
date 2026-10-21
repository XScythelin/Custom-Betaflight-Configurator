<template>
    <section class="p-4">
        <h2 class="text-2xl font-semibold mb-4">Автоматический настройщик</h2>
        <ol class="flex flex-col gap-3 list-none p-0">
            <li class="flex items-center gap-3">
                <span class="text-xl font-semibold" aria-hidden="true">1)</span>
                <UButton size="xl" class="text-base" icon="i-lucide-zap" :disabled="busy" @click="chooseHex"
                    >Выбрать HEX и прошить</UButton
                >
            </li>
            <li class="flex items-center gap-3">
                <span class="text-xl font-semibold" aria-hidden="true">2)</span>
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-file-check"
                    :loading="busy"
                    :disabled="busy"
                    @click="chooseDump"
                    >Загрузить дамп и проверить</UButton
                >
            </li>
            <li class="flex items-center gap-3">
                <span class="text-xl font-semibold" aria-hidden="true">3)</span>
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-axis-3d"
                    :disabled="actionsBusy"
                    @click="accConfirmation = true"
                    >Калибровка акселерометра</UButton
                >
            </li>
            <li class="flex items-center gap-3">
                <span class="text-xl font-semibold" aria-hidden="true">4)</span>
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-activity"
                    :disabled="actionsBusy"
                    @click="gyroConfirmation = true"
                    >Калибровка гироскопа</UButton
                >
            </li>
        </ol>
        <section class="mt-6" aria-label="Дополнительные инструменты">
            <h3 class="text-lg font-semibold mb-3">Дополнительные инструменты</h3>
            <div class="flex flex-col items-start gap-3">
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-power"
                    :disabled="actionsBusy"
                    @click="perform('gyroAutoOn')"
                    >Включить автокалибровку гироскопа</UButton
                >
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-power-off"
                    :disabled="actionsBusy"
                    @click="perform('gyroAutoOff')"
                    >Отключить автокалибровку гироскопа</UButton
                >
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-usb"
                    :disabled="actionsBusy"
                    @click="perform('streamUsb')"
                    >Включить стриминг на USB</UButton
                >
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-file-input"
                    :disabled="actionsBusy"
                    @click="chooseStreamDump"
                    >Вернуть стриминг в норму</UButton
                >
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-activity"
                    :disabled="actionsBusy"
                    @click="perform('gyro')"
                    >Проверка гироскопа</UButton
                >
                <UButton
                    size="xl"
                    class="text-base"
                    icon="i-lucide-terminal"
                    :disabled="actionsBusy"
                    @click="perform('cli')"
                    >Открыть CLI</UButton
                >
            </div>
        </section>
        <p v-if="error" role="alert">{{ error }}</p>
        <UModal v-model:open="dumpDeviceSelectionOpen" title="Выберите полётник для загрузки дампа">
            <template #body>
                <p class="mb-3">Выберите USB COM-порт полётника в обычном режиме, не DFU.</p>
                <UButton @click="selectDumpDevice">Выбрать USB COM-порт</UButton>
                <p v-if="deviceError" role="alert">{{ deviceError }}</p>
            </template>
        </UModal>
        <UModal v-model:open="deviceSelectionOpen" title="Выберите полётник">
            <template #body>
                <p class="mb-3">Выберите COM-порт полётника или USB DFU, если он уже в загрузчике.</p>
                <div class="flex flex-wrap gap-3">
                    <UButton @click="selectDevice('serial')">Выбрать COM-порт</UButton>
                    <UButton @click="selectDevice('usb')">Выбрать USB DFU</UButton>
                </div>
                <p v-if="error" role="alert">{{ error }}</p>
            </template>
        </UModal>
    </section>
</template>

<script setup lang="ts">
import { useDdProgrammer } from "../composables/useDdProgrammer";
import { useDdDump } from "../composables/useDdDump";
import { useDdQuickActions } from "../composables/useDdQuickActions";
const { busy: actionsBusy, perform, accConfirmation, gyroConfirmation, chooseStreamDump } = useDdQuickActions();
const { chooseHex, error, deviceSelectionOpen, selectDevice } = useDdProgrammer();
const { chooseDump, busy, dumpDeviceSelectionOpen, selectDumpDevice, deviceError } = useDdDump();
</script>
