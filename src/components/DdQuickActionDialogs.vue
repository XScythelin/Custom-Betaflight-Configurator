<template>
    <UModal v-model:open="accConfirmation" title="Калибровка акселерометра">
        <template #body>
            <p>
                Снимите пропеллеры. Положите плату или собранный аппарат горизонтально, в нормальном полётном положении.
                Не двигайте во время калибровки.
            </p>
            <UButton class="mt-3" :disabled="busy" @click="startAcc">Плата лежит ровно — калибровать</UButton>
        </template>
    </UModal>
    <UModal v-model:open="gyroConfirmation" title="Калибровка гироскопа">
        <template #body>
            <p>
                Снимите пропеллеры, выключите ARM и не двигайте плату. После успешной калибровки результат будет
                автоматически сохранён во flash.
            </p>
            <UButton class="mt-3" :disabled="busy" @click="startGyro">Калибровать и сохранить</UButton>
        </template>
    </UModal>
    <UModal v-model:open="baroConfirmation" title="Калибровка барометра">
        <template #body>
            <p>
                Снимите пропеллеры, выключите ARM. Держите аппарат неподвижно, избегайте потоков воздуха и изменения
                давления. После успешной калибровки ноль будет сохранён в EEPROM.
            </p>
            <UButton class="mt-3" :disabled="busy" @click="startBaro">Калибровать и сохранить</UButton>
        </template>
    </UModal>
    <UModal v-model:open="opened" title="Настройка полётника" :dismissible="!busy">
        <template #body>
            <p v-if="message" role="status">{{ message }}</p>
            <pre v-if="replies" class="whitespace-pre-wrap mt-3" role="log">{{ replies }}</pre>
            <template v-if="needsPort">
                <p class="mb-3">Выберите USB COM-порт полётника. Нужен обычный режим, не DFU.</p>
                <UButton @click="selectPort">Выбрать COM-порт</UButton>
            </template>
        </template>
    </UModal>
</template>

<script setup lang="ts">
import { useDdQuickActions } from "../composables/useDdQuickActions";
const {
    busy,
    opened,
    message,
    needsPort,
    accConfirmation,
    gyroConfirmation,
    baroConfirmation,
    replies,
    perform,
    selectPort,
} = useDdQuickActions();
function startGyro() {
    gyroConfirmation.value = false;
    void perform("gyroCalibrate");
}
function startBaro() {
    baroConfirmation.value = false;
    void perform("baroCalibrate");
}
function startAcc() {
    accConfirmation.value = false;
    void perform("acc");
}
</script>
